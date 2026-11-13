import { parseBoundedCsv } from "../lib/economy/csv-input";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ownedJob, user } from "./ownership";
import { optionsValidator } from "./marketModel";
import { validateMission } from "../lib/missions";
import { validateServiceOptions } from "../lib/economy";
import { childrenComplete, event, finish } from "./workflowHelpers";
import {
  publicBid,
  publicNegotiation,
  publicContract,
  publicEvent,
} from "./publicMarket";
export const start = mutation({
  // options is a compatibility assertion, never an override of the saved brief.
  args: { missionId: v.id("missions"), options: v.optional(optionsValidator) },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.ownerId !== ownerId)
      throw new ConvexError("MISSION_NOT_FOUND");
    if (mission.contentRemovedAt !== undefined) throw new ConvexError("DATASET_REMOVED");
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .filter((q) => q.eq(q.field("depth"), 0))
      .unique();
    if (existing) {
      if (args.options && JSON.stringify(existing.options) !== JSON.stringify(args.options))
        throw new ConvexError("START_OPTIONS_CHANGED");
      return existing._id;
    }
    try {
      validateMission(mission);
    } catch {
      throw new ConvexError("INVALID_OR_EXPIRED_MISSION");
    }
    const csv = parseBoundedCsv(mission.inputCsv);
    if (!csv.ok) throw new ConvexError("INVALID_OR_EXPIRED_MISSION");
    const columns = csv.value.rawHeader;
    const result = validateServiceOptions(mission.serviceType, mission.options, columns);
    if (!result.ok) throw new ConvexError({ code: result.code, message: result.message });
    if (args.options) {
      const assertion = validateServiceOptions(mission.serviceType, args.options, columns);
      if (!assertion.ok) throw new ConvexError({ code: assertion.code, message: assertion.message });
      if (JSON.stringify(assertion.value) !== JSON.stringify(result.value))
        throw new ConvexError("START_OPTIONS_CHANGED");
    }
    const now = Date.now();
    const id = await ctx.db.insert("jobs", {
      ownerId,
      missionId: mission._id,
      depth: 0,
      engineManaged: true,
      workerVersion: 0,
      retryCount: 0,
      cleanBeforeProcessing: mission.cleanBeforeProcessing ?? false,
      requiresHumanReview: mission.requiresHumanReview ?? true,
      serviceType: mission.serviceType,
      inputCsv: mission.inputCsv,
      options: result.value,
      budgetYocto: mission.maxBudgetYocto,
      reservedYocto: "0",
      state: "bidding",
      revisionCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(mission._id, { state: "active", updatedAt: now });
    await event(
      ctx,
      (await ctx.db.get(id))!,
      "AUCTION_OPENED",
      "Mission opened for independent service offers. No funds have moved.",
    );
    await ctx.scheduler.runAfter(1500, internal.economyWorker.step, { jobId: id, version: 0 });
    return id;
  },
});
export const resume = mutation({
  args: { id: v.id("jobs") },
  handler: async (ctx, { id }) => {
    const job = await ownedJob(ctx, id);
    if (!job.engineManaged || !job.workerError || (job.retryCount ?? 0) >= 3 || !["bidding", "working", "verifying", "revision"].includes(job.state))
      throw new ConvexError("WORKFLOW_NOT_RETRYABLE");
    await ctx.db.patch(id, { workerError: undefined, retryCount: (job.retryCount ?? 0) + 1 });
    await ctx.scheduler.runAfter(0, internal.economyWorker.step, { jobId: id, version: job.workerVersion ?? 0 });
    await event(ctx, job, "WORKFLOW_RESUMED", "Owner resumed this workflow. No payment was requested.");
  },
});
export const detail = query({
  args: { id: v.id("jobs") },
  handler: async (ctx, { id }) => {
    const job = await ownedJob(ctx, id);
    const [
      bids,
      negotiations,
      contracts,
      deliverables,
      verifications,
      children,
      disputes,
      events,
    ] = await Promise.all([
      ctx.db
        .query("bids")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(10),
      ctx.db
        .query("negotiations")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(30),
      ctx.db
        .query("contracts")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(1),
      ctx.db
        .query("deliverables")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(2),
      ctx.db
        .query("verifications")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(2),
      ctx.db
        .query("jobs")
        .withIndex("by_parent", (q) => q.eq("parentId", id))
        .take(1),
      ctx.db
        .query("disputes")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(1),
      ctx.db
        .query("economyEvents")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .order("desc")
        .take(100),
    ]);
    return {
      job,
      bids: bids.map(publicBid),
      negotiations: negotiations.map(publicNegotiation),
      contracts: contracts.map(publicContract),
      deliverables: deliverables.map((d) => ({ _id: d._id, _creationTime: d._creationTime, jobId: d.jobId, attempt: d.attempt, format: d.format, content: d.content, createdAt: d.createdAt, dependencyDeliverableId: d.dependencyDeliverableId ?? null })),
      verifications,
      children,
      disputes,
      events: events.map(publicEvent),
    };
  },
});
export const forMission = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    const ownerId = await user(ctx);
    const m = await ctx.db.get(missionId);
    if (!m || m.ownerId !== ownerId) throw new ConvexError("MISSION_NOT_FOUND");
    return ctx.db
      .query("jobs")
      .withIndex("by_mission", (q) => q.eq("missionId", missionId))
      .take(2);
  },
});
export const cancel = mutation({
  args: { id: v.id("jobs") },
  handler: async (ctx, { id }) => {
    const job = await ownedJob(ctx, id);
    if (job.depth !== 0 || job.state !== "bidding")
      throw new ConvexError("CANNOT_CANCEL_COMMITTED_WORK");
    await ctx.db.patch(id, { state: "cancelled", updatedAt: Date.now() });
    await event(
      ctx,
      job,
      "JOB_CANCELLED",
      "Owner cancelled an unawarded auction.",
    );
  },
});
export const resolveDispute = mutation({
  args: {
    id: v.id("jobs"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ownedJob(ctx, args.id);
    if (job.state !== "disputed") throw new ConvexError("NO_OPEN_DISPUTE");
    if (!args.reason.trim() || args.reason.length > 1000)
      throw new ConvexError("INVALID_REASON");
    const dispute = await ctx.db
      .query("disputes")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .unique();
    if (!dispute || dispute.decision) throw new ConvexError("NO_OPEN_DISPUTE");
    if (args.decision === "approve") {
      await childrenComplete(ctx, job);
      if (!(await ctx.db.query("deliverables").withIndex("by_job", (q) => q.eq("jobId", job._id)).first()))
        throw new ConvexError("NO_DELIVERABLE_TO_APPROVE");
    }
    await finish(
      ctx,
      job,
      args.decision === "approve",
      args.decision === "approve" ? "buyer_approved" : "rejected",
    );
    await ctx.db.patch(dispute._id, {
      decision: args.decision,
      decidedBy: job.ownerId,
      decidedAt: Date.now(),
    });
    await event(ctx, job, "DISPUTE_RESOLVED", args.reason.trim());
  },
});

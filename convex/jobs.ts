import Papa from "papaparse";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownedJob, user } from "./ownership";
import { optionsValidator } from "./marketModel";
import { validateMission } from "../lib/missions";
import { event, finish } from "./workflowHelpers";
export const start = mutation({
  args: { missionId: v.id("missions"), options: optionsValidator },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.ownerId !== ownerId)
      throw new ConvexError("MISSION_NOT_FOUND");
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .filter((q) => q.eq(q.field("depth"), 0))
      .unique();
    if (existing) {
      if (JSON.stringify(existing.options) !== JSON.stringify(args.options))
        throw new ConvexError("START_OPTIONS_CHANGED");
      return existing._id;
    }
    try {
      validateMission(mission);
    } catch {
      throw new ConvexError("INVALID_OR_EXPIRED_MISSION");
    }
    const columns = Papa.parse<string[]>(mission.inputCsv, {
      skipEmptyLines: "greedy",
    }).data[0];
    if (
      !args.options.columns.length ||
      args.options.columns.length > 32 ||
      new Set(args.options.columns).size !== args.options.columns.length ||
      args.options.columns.some((c) => !columns.includes(c))
    )
      throw new ConvexError("INVALID_COLUMNS");
    if (
      mission.serviceType === "csv_summary" &&
      args.options.caseMode !== undefined
    )
      throw new ConvexError("INVALID_OPTIONS");
    if (mission.serviceType === "csv_normalize" && !args.options.caseMode)
      throw new ConvexError("INVALID_OPTIONS");
    const now = Date.now();
    const id = await ctx.db.insert("jobs", {
      ownerId,
      missionId: mission._id,
      depth: 0,
      serviceType: mission.serviceType,
      inputCsv: mission.inputCsv,
      options: args.options,
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
      "Mission opened for bids. Execution engine integration is pending; no bids or work are simulated.",
    );
    return id;
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
      bids,
      negotiations,
      contracts,
      deliverables,
      verifications,
      children,
      disputes,
      events,
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

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { reputationWriteAllowed } from "../lib/settlement/policy";
import { internal } from "./_generated/api";
export function text(value: string) {
  if (!value.trim() || value.length > 1000)
    throw new ConvexError("INVALID_EXPLANATION");
  return value.trim();
}
export function amount(value: string) {
  if (!/^(0|[1-9]\d{0,27})$/.test(value))
    throw new ConvexError("INVALID_AMOUNT");
  return BigInt(value);
}
export async function jobById(ctx: MutationCtx, id: Id<"jobs">) {
  const j = await ctx.db.get(id);
  if (!j) throw new ConvexError("JOB_NOT_FOUND");
  return j;
}
export async function event(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  type: string,
  detail: string,
) {
  await ctx.db.insert("economyEvents", {
    ownerId: job.ownerId,
    missionId: job.missionId,
    jobId: job._id,
    type,
    detail: text(detail),
    createdAt: Date.now(),
  });
}
export async function childrenComplete(ctx: MutationCtx, job: Doc<"jobs">) {
  const child = await ctx.db
    .query("jobs")
    .withIndex("by_parent", (q) => q.eq("parentId", job._id))
    .unique();
  if (child && child.state !== "approved")
    throw new ConvexError("CHILD_WORK_INCOMPLETE");
}
// Waiting for a human retains the full financial obligation, but consumes no
// execution slot. This changes neither approval nor payment eligibility.
export async function reviewCapacity(ctx: MutationCtx, job: Doc<"jobs">): Promise<void> {
  const contract = await ctx.db.query("contracts").withIndex("by_job", (q) => q.eq("jobId", job._id)).unique();
  if (contract?.state === "active") {
    await ctx.db.patch(contract._id, { state: "awaiting_review" });
    await event(ctx, job, "AWAITING_OWNER_REVIEW", "Processing capacity released. The contract allocation remains reserved and payment remains blocked until approval.");
  }
  // A disputed child without any output cannot be approved. Its parent has
  // no runnable continuation either, so expose owner review and free both
  // execution slots. Children with output may still be approved and resume.
  if (job.parentId && (await ctx.db.get(job._id))?.state === "disputed" &&
      !(await ctx.db.query("deliverables").withIndex("by_job", (q) => q.eq("jobId", job._id)).first())) {
    const parent = await ctx.db.get(job.parentId);
    if (parent?.state === "working") {
      await ctx.db.patch(parent._id, { state: "disputed", updatedAt: Date.now() });
      await ctx.db.insert("disputes", { jobId: parent._id, reason: "Required subcontract needs review and has no approvable output" });
      await reviewCapacity(ctx, parent);
      await event(ctx, parent, "DEPENDENCY_FAILED", "Required child work has no deliverable. Parent approval remains blocked; owner may reject both contracts. Financial allocations are preserved.");
    }
  }
}
export async function finish(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  approved: boolean,
  cause: "verified" | "buyer_approved" | "rejected",
): Promise<void> {
  if (!reputationWriteAllowed("verified_workflow"))
    throw new ConvexError("REPUTATION_AUTHORITY_REQUIRED");
  if (approved) await childrenComplete(ctx, job);
  const contract = await ctx.db
    .query("contracts")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .unique();
  if (!contract) throw new ConvexError("NO_CONTRACT");
  if (
    await ctx.db
      .query("reputationEvents")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .unique()
  )
    throw new ConvexError("ALREADY_FINALIZED");
  await ctx.db.patch(job._id, {
    state: approved ? "approved" : "rejected",
    updatedAt: Date.now(),
  });
  await ctx.db.patch(contract._id, {
    state: approved ? "completed" : "failed",
  });
  await ctx.db.insert("reputationEvents", {
    jobId: job._id,
    agentId: contract.agentId,
    delta: approved ? 10 : -5,
    cause,
    createdAt: Date.now(),
  });
  await event(
    ctx,
    job,
    approved ? "WORK_APPROVED" : "WORK_REJECTED",
    approved
      ? "Work accepted; no payment has been submitted."
      : "Work rejected; no payment has been submitted.",
  );
  if (!approved && job.parentId) {
    const parent = await ctx.db.get(job.parentId);
    if (parent && parent.state === "working") {
      await ctx.db.patch(parent._id, {
        state: "disputed",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("disputes", {
        jobId: parent._id,
        reason: "Required subcontract was rejected",
      });
      await reviewCapacity(ctx, parent);
      await event(
        ctx,
        parent,
        "DEPENDENCY_FAILED",
        "Required child work rejected. Parent approval remains blocked; owner may reject the parent.",
      );
    }
  }
  if (approved && job.parentId) {
    const parent = await ctx.db.get(job.parentId);
    if (parent?.engineManaged && parent.state === "working")
      await ctx.scheduler.runAfter(0, internal.economyWorker.step, { jobId: parent._id, version: parent.workerVersion ?? 0 });
  }
}

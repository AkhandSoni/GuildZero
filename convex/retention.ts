import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { user } from "./ownership";
import { deliveryAccess } from "./deliveryAccess";

const removed = "Content removed by owner";
const terminal = new Set(["approved", "rejected", "cancelled", "unawarded"]);

// Bounds cover the current depth-one/two-attempt workflow. Unexpected legacy
// groups fail closed, so no partial deletion or silently truncated audit occurs.
async function snapshot(ctx: QueryCtx, id: Id<"missions">) {
  const ownerId = await user(ctx);
  const mission = await ctx.db.get(id);
  if (!mission || mission.ownerId !== ownerId) throw new ConvexError("MISSION_NOT_FOUND");
  const jobs = await ctx.db.query("jobs").withIndex("by_mission", q => q.eq("missionId", id)).take(3);
  const rows = await Promise.all(jobs.map(async job => ({
    job,
    contracts: await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", job._id)).take(3),
    payments: await ctx.db.query("paymentIntents").withIndex("by_job", q => q.eq("jobId", job._id)).take(3),
    deliverables: await ctx.db.query("deliverables").withIndex("by_job", q => q.eq("jobId", job._id)).order("desc").take(3),
    verifications: await ctx.db.query("verifications").withIndex("by_job", q => q.eq("jobId", job._id)).take(3),
    disputes: await ctx.db.query("disputes").withIndex("by_job", q => q.eq("jobId", job._id)).take(3),
    bids: await ctx.db.query("bids").withIndex("by_job", q => q.eq("jobId", job._id)).take(11),
    negotiations: await ctx.db.query("negotiations").withIndex("by_job", q => q.eq("jobId", job._id)).take(31),
    events: await ctx.db.query("economyEvents").withIndex("by_job", q => q.eq("jobId", job._id)).take(201),
    security: await ctx.db.query("securityEvents").withIndex("by_job", q => q.eq("jobId", job._id)).take(201),
  })));
  let reason: string | null = null;
  if (mission.state !== "active" || !jobs.length) reason = "Delete unused drafts with Delete draft.";
  if (jobs.length > 2 || jobs.filter(j => j.depth === 0).length !== 1 || jobs.some(j => j.ownerId !== ownerId || (j.depth === 1 && !jobs.some(p => p.depth === 0 && p._id === j.parentId)))) reason = "Mission group requires operator review.";
  for (const row of rows) {
    if (row.contracts.length > 1 || row.payments.length > 1 || row.deliverables.length > 2 || row.verifications.length > 2 || row.disputes.length > 1 || row.bids.length > 10 || row.negotiations.length > 30 || row.events.length > 200 || row.security.length > 200) reason = "History exceeds safe removal bounds; operator review required.";
    if (row.job.state === "approved" && !row.contracts.some(c => c.state === "completed")) reason = "Approved work requires its completed financial obligation before removal.";
    if (!terminal.has(row.job.state) || row.contracts.some(c => c.state === "active" || c.state === "awaiting_review") || row.disputes.some(d => !d.decision)) reason = "Finish or cancel all parent and child work before removing content.";
    for (const payment of row.payments) {
      const lock = await ctx.db.query("signerLocks").withIndex("by_sender", q => q.eq("sender", payment.sender)).unique();
      if (payment.status !== "CONFIRMED" || lock?.intentId === payment._id || payment.ownerId !== ownerId || !payment.txHash || !payment.blockHash || !payment.nonce) reason = "Settlement remains unresolved; keep content for reconciliation.";
    }
    if (row.payments.some(p => !row.contracts.some(c => c._id === p.contractId && c.state === "completed"))) reason = "Financial history requires operator review.";
  }
  if (!reason && rows.some(row => row.contracts.some(contract => contract.state === "completed"))) {
    const root = jobs.find(job => job.depth === 0)!;
    // Irreversible deletion must require exactly the same complete group proof
    // as full delivery: final evidence, distinct transfers, conserved allocation
    // and latest parent/child dependency bindings. Never duplicate this policy.
    const access = await deliveryAccess(ctx, root);
    if (!access.released) reason = `Confirmed delivery evidence required before removal: ${access.reason}.`;
  }
  return { mission, rows, reason };
}

export const status = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    const { mission, reason } = await snapshot(ctx, missionId);
    return { removedAt: mission.contentRemovedAt ?? null, eligible: reason === null, reason };
  },
});

export const removeContent = mutation({
  args: { missionId: v.id("missions"), confirm: v.literal("REMOVE_DATASET_AND_OUTPUTS") },
  handler: async (ctx, { missionId }) => {
    const { mission, rows, reason } = await snapshot(ctx, missionId);
    if (mission.contentRemovedAt !== undefined) return;
    if (reason) throw new ConvexError(reason);
    const now = Date.now();
    await ctx.db.patch(missionId, { inputCsv: "", acceptanceCriteria: "", title: removed, options: undefined, contentRemovedAt: now, updatedAt: now });
    for (const row of rows) {
      await ctx.db.patch(row.job._id, { inputCsv: "", options: { columns: [] }, workerError: undefined, contentRemovedAt: now });
      for (const d of row.deliverables) await ctx.db.patch(d._id, { content: "", verificationPayload: undefined });
      for (const v of row.verifications) await ctx.db.patch(v._id, { checks: v.checks.map(c => ({ ...c, detail: removed })) });
      for (const d of row.disputes) await ctx.db.patch(d._id, { reason: removed });
      for (const b of row.bids) await ctx.db.patch(b._id, { rationale: removed });
      for (const n of row.negotiations) await ctx.db.patch(n._id, { explanation: removed });
      for (const c of row.contracts) await ctx.db.patch(c._id, { selectionReason: removed });
      for (const e of row.events) await ctx.db.patch(e._id, { detail: removed });
      for (const e of row.security) await ctx.db.patch(e._id, { reason: removed });
    }
    const root = rows.find(r => r.job.depth === 0)!.job;
    await ctx.db.insert("economyEvents", { ownerId: mission.ownerId, missionId, jobId: root._id, type: "CONTENT_REMOVED", detail: "Owner removed private content under demo retention policy v1. Financial identities and public chain evidence retained.", createdAt: now });
  },
});

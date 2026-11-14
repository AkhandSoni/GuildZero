import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { deliveryAccess, deliverablePreview } from "./deliveryAccess";
import { currentAttempt } from "./paymentRecoveryHelpers";
export function missionProjection(row: Doc<"missions">) {
  return {id: row._id, title: row.title, serviceType: row.serviceType, maxBudgetYocto: row.maxBudgetYocto, deadlineAt: row.deadlineAt,
    acceptanceCriteria: row.acceptanceCriteria, cleanBeforeProcessing: row.cleanBeforeProcessing ?? false, requiresHumanReview: row.requiresHumanReview ?? true,
    options: row.options ? {columns: row.options.columns, ...(row.options.caseMode ? {caseMode: row.options.caseMode} : {}), ...(row.options.numericColumns ? {numericColumns: row.options.numericColumns} : {}), ...(row.options.keyColumn ? {keyColumn: row.options.keyColumn} : {}), ...(row.options.groupBy ? {groupBy: row.options.groupBy} : {})} : null,
    state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt};
}
export function jobReference(row: Doc<"jobs">) { return {id: row._id, state: row.state, parentId: row.parentId ?? null, depth: row.depth}; }
export function jobProjection(row: Doc<"jobs">) { return {...jobReference(row), missionId: row.missionId, serviceType: row.serviceType, budgetYocto: row.budgetYocto, reservedYocto: row.reservedYocto}; }
export async function paymentProjection(ctx: QueryCtx, job: Doc<"jobs">) {
  const intent = await ctx.db.query("paymentIntents").withIndex("by_job", q => q.eq("jobId", job._id)).unique();
  if (!intent || intent.ownerId !== job.ownerId) return null;
  const access = await deliveryAccess(ctx, job);
  const obligation = access.obligations.find(row => row.job._id === job._id);
  const confirmed = Boolean(obligation?.confirmed);
  const attempt = intent.recoveryVersion === 2 ? await currentAttempt(ctx, intent) : null;
  // Only validated receipt metadata is evidence. Preserve original tx identity even while unconfirmed.
  const safeReason = intent.lastReason && /^[A-Z][A-Z0-9_]{0,199}$/.test(intent.lastReason) ? intent.lastReason : null;
  return {id: intent._id, status: intent.status, network: intent.network, recipient: intent.recipient, amountYocto: intent.amountYocto,
    currentAttemptId: attempt?._id ?? null, lastReason: safeReason,
    txHash: intent.txHash && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(intent.txHash) ? intent.txHash : null,
    blockHash: confirmed ? intent.blockHash ?? null : null, nonce: confirmed ? intent.nonce ?? null : null, confirmed};
}
export async function resultProjection(ctx: QueryCtx, job: Doc<"jobs">) {
  const access = await deliveryAccess(ctx, job);
  const latest = access.obligations.find(row => row.job._id === job._id)?.deliverable
    ?? await ctx.db.query("deliverables").withIndex("by_job", q => q.eq("jobId", job._id)).order("desc").first();
  return {jobId: job._id, locked: !access.released || !latest, reason: access.reason,
    preview: latest ? deliverablePreview(latest) : null, requiredPayments: access.obligations.length,
    confirmedPayments: access.obligations.filter(row => row.confirmed).length,
    deliverable: access.released && latest ? {id: latest._id, format: latest.format, content: latest.content} : null};
}

/** Event text may contain human notes or legacy private diagnostics. Keep event identity/type/time, with static MCP text. */
export function safeEventDetail(type: string) {
  const labels: Record<string,string> = {AUCTION_OPENED:"Auction opened; no funds moved.",BID_SUBMITTED:"Seller submitted an eligible public offer.",NEGOTIATION:"A bounded negotiation action was recorded.",CONTRACT_AWARDED:"An eligible offer was awarded within the buyer budget.",DELIVERABLE_SUBMITTED:"A deliverable was submitted for independent verification.",VERIFICATION_RESULT:"The independent verification verdict was recorded.",WORK_APPROVED:"Work was approved; payment confirmation remains separate.",WORK_REJECTED:"Work was rejected.",DISPUTE_RESOLVED:"The owner resolved a work dispute.",DELIVERABLE_RELEASED:"The latest deliverable was released under the settlement policy."};
  return labels[type] ?? "A persisted marketplace event was recorded. Inspect the trusted mission UI for details.";
}

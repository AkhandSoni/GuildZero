import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const MAX_PAYMENT_ATTEMPTS = 5;
export const recoveryEnabled = () => process.env.NEAR_PAYMENT_RETRY_ENABLED === "true";
function sameObligation(attempt: Doc<"paymentAttempts">, intent: Doc<"paymentIntents">) {
  return attempt.intentId === intent._id &&
    (["ownerId", "jobId", "contractId", "deliverableId", "verificationId", "disputeId", "policyVersion", "network", "sender", "recipient", "amountYocto"] as const)
      .every(key => attempt[key] === intent[key]);
}
export function attemptMatches(attempt: Doc<"paymentAttempts">, intent: Doc<"paymentIntents">) {
  return intent.recoveryVersion === 2 && intent.currentAttemptId === attempt._id &&
    intent.attemptCount === attempt.generation && attempt.authorizedAt === intent.authorizedAt && sameObligation(attempt, intent);
}
export function hasPreSignClosure(attempt: Doc<"paymentAttempts">) {
  return attempt.phase === "CLOSED_PRE_SIGN_FAILURE" && Number.isSafeInteger(attempt.closedAt) &&
    Number.isSafeInteger(attempt.authorizedAt) && /^[a-f0-9]{64}$/.test(attempt.claimToken ?? "") &&
    attempt.signingStartedAt === undefined && attempt.broadcastStartedAt === undefined &&
    attempt.txHash === undefined && attempt.nonce === undefined;
}
export function validAttemptHistory(rows: Doc<"paymentAttempts">[], intent: Doc<"paymentIntents">) {
  return rows.length === intent.attemptCount && rows.length >= 1 && rows.length <= MAX_PAYMENT_ATTEMPTS &&
    new Set(rows.map(row => row.generation)).size === rows.length && rows.every(row =>
      sameObligation(row, intent) && Number.isSafeInteger(row.generation) && row.generation >= 1 && row.generation <= rows.length &&
      (row._id === intent.currentAttemptId || hasPreSignClosure(row)));
}
export async function appendAttempt(ctx: MutationCtx, intent: Doc<"paymentIntents">, generation: number) {
  if (intent.recoveryVersion !== 2 || !intent.deliverableId || !intent.verificationId ||
      !Number.isSafeInteger(generation) || generation < 1 || generation > MAX_PAYMENT_ATTEMPTS)
    throw new ConvexError("INVALID_PAYMENT_ATTEMPT");
  return ctx.db.insert("paymentAttempts", {
    intentId: intent._id, ownerId: intent.ownerId, jobId: intent.jobId, contractId: intent.contractId,
    deliverableId: intent.deliverableId, verificationId: intent.verificationId,
    ...(intent.disputeId ? { disputeId: intent.disputeId } : {}), policyVersion: intent.policyVersion!,
    network: intent.network, sender: intent.sender, recipient: intent.recipient, amountYocto: intent.amountYocto,
    generation, phase: "READY", createdAt: Date.now(),
  });
}
export async function currentAttempt(ctx: QueryCtx, intent: Doc<"paymentIntents">) {
  const attempt = intent.currentAttemptId ? await ctx.db.get(intent.currentAttemptId) : null;
  return attempt && attemptMatches(attempt, intent) ? attempt : null;
}
export async function confirmedAttempt(ctx: QueryCtx, intent: Doc<"paymentIntents">) {
  if (intent.recoveryVersion !== 2) return true;
  const attempt = await currentAttempt(ctx, intent);
  const history = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("intentId", intent._id)).take(MAX_PAYMENT_ATTEMPTS + 1);
  return !!(attempt && validAttemptHistory(history, intent) && attempt.phase === "CONFIRMED" && attempt.txHash === intent.txHash &&
    attempt.nonce === intent.nonce && attempt.blockHash === intent.blockHash &&
    attempt.authorizedAt === intent.authorizedAt && attempt.lastCheckAt === intent.lastCheckAt &&
    attempt.lastReason === "FINAL_MATCHING_TRANSFER");
}
export async function recoveryProjection(ctx: QueryCtx, intent: Doc<"paymentIntents">) {
  if (intent.recoveryVersion !== 2) return null;
  const attempt = await currentAttempt(ctx, intent);
  const rows = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("intentId", intent._id)).take(MAX_PAYMENT_ATTEMPTS + 1);
  const historyValid = validAttemptHistory(rows, intent);
  const eligible = !!(recoveryEnabled() && historyValid && attempt && intent.status === "FAILED" &&
    hasPreSignClosure(attempt) && intent.txHash === undefined && intent.nonce === undefined && intent.blockHash === undefined && rows.length < MAX_PAYMENT_ATTEMPTS);
  return {
    eligible, enabled: recoveryEnabled(), attemptId: attempt?._id ?? null, generation: attempt?.generation ?? null,
    phase: attempt?.phase ?? null,
    reason: !recoveryEnabled() ? "PAYMENT_RECOVERY_DISABLED" : !attempt || !historyValid ? "PAYMENT_ATTEMPT_HISTORY_INVALID"
      : rows.length >= MAX_PAYMENT_ATTEMPTS ? "PAYMENT_RETRY_LIMIT_REACHED"
      : eligible ? "VERIFIED_PRE_SIGN_CLOSURE" : "PAYMENT_RETRY_NOT_PROVEN_SAFE",
    // No claim tokens or raw callback data are exposed to the browser.
    history: rows.sort((a, b) => a.generation - b.generation).map(row => ({ id: row._id, generation: row.generation, phase: row.phase,
      createdAt: row.createdAt, reason: row.lastReason ?? null, txHash: row.txHash ?? null })),
  };
}

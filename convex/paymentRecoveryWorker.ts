import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { attemptMatches, recoveryEnabled } from "./paymentRecoveryHelpers";
import { quote, bindingReason, audit } from "./paymentHelpers";
import { enforceAllowance } from "./allowanceHelpers";
import { configuration, inspectReceipt } from "../lib/settlement/policy";
import { recordDeliveryRelease } from "./deliveryAccess";
import { event } from "./workflowHelpers";
const args = { attemptId: v.id("paymentAttempts"), token: v.string() };
const preSignReasons = new Set(["SENDER_CONFIGURATION_CHANGED", "TESTNET_CHECK_FAILED", "OPERATOR_ACCOUNT_LOOKUP_FAILED",
  "PROTOCOL_CONFIGURATION_UNAVAILABLE", "INVALID_BALANCE_EVIDENCE", "INSUFFICIENT_OPERATOR_BALANCE", "RECIPIENT_ACCOUNT_LOOKUP_FAILED"]);
async function execution(ctx: MutationCtx, input: { attemptId: Doc<"paymentAttempts">["_id"]; token: string }) {
  const attempt = await ctx.db.get(input.attemptId);
  if (!attempt || attempt.claimToken !== input.token) return null;
  const intent = await ctx.db.get(attempt.intentId);
  if (!intent || !attemptMatches(attempt, intent)) return null;
  const lock = await ctx.db.query("signerLocks").withIndex("by_sender", q => q.eq("sender", intent.sender)).unique();
  if (lock?.intentId !== intent._id || lock.attemptId !== attempt._id) return null;
  return { attempt, intent, lock };
}
async function close(ctx: MutationCtx, state: NonNullable<Awaited<ReturnType<typeof execution>>>, reason: string) {
  // Atomic with signingPermit: a closed worker can never obtain permission later.
  if (state.attempt.phase !== "PREPARING" || state.attempt.signingStartedAt !== undefined || state.attempt.txHash) return;
  const lastReason = "VERIFIED_PRE_SIGN_FAILURE:" + reason;
  await ctx.db.patch(state.attempt._id, { phase: "CLOSED_PRE_SIGN_FAILURE", closedAt: Date.now(), lastReason });
  await ctx.db.patch(state.intent._id, { status: "FAILED", lastReason, lastCheckAt: Date.now() });
  await ctx.db.delete(state.lock._id);
  const job = await ctx.db.get(state.intent.jobId);
  if (job) { await audit(ctx, job, "PAYMENT_PRE_SIGN_CLOSURE", reason); await event(ctx, job, "PAYMENT_FAILED", "Attempt " + state.attempt.generation + " stopped during payment preparation. Nothing was signed or sent."); }
}
export const snapshot = internalQuery({
  args: { attemptId: v.id("paymentAttempts") }, handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get(attemptId), intent = attempt ? await ctx.db.get(attempt.intentId) : null;
    return attempt && intent && attemptMatches(attempt, intent) ? { attempt, intent } : null;
  },
});
export const claim = internalMutation({ args, handler: async (ctx, input) => {
  if (!/^[a-f0-9]{64}$/.test(input.token)) return null;
  const attempt = await ctx.db.get(input.attemptId), intent = attempt ? await ctx.db.get(attempt.intentId) : null;
  if (!attempt || !intent || !attemptMatches(attempt, intent) || attempt.phase !== "READY" ||
      intent.status !== "READY" || !intent.authorizedAt || attempt.authorizedAt !== intent.authorizedAt) return null;
  const job = await ctx.db.get(intent.jobId);
  if (!job) return null;
  let reason: string | null = null;
  try {
    reason = !recoveryEnabled() ? "PAYMENT_RECOVERY_DISABLED" : bindingReason(intent, await quote(ctx, job));
    if (!reason && !configuration().enabled) reason = "SETTLEMENT_CONFIGURATION_REQUIRED";
    if (!reason) await enforceAllowance(ctx, intent.ownerId);
  } catch { reason = "PAYMENT_POLICY_CHANGED"; }
  if (!reason && await ctx.db.query("signerLocks").withIndex("by_sender", q => q.eq("sender", intent.sender)).unique()) reason = "SIGNER_BUSY_REAUTHORIZE_LATER";
  if (reason) {
    await ctx.db.patch(intent._id, { authorizedAt: undefined, lastReason: reason });
    await ctx.db.patch(attempt._id, { authorizedAt: undefined });
    await audit(ctx, job, "CLAIM_PAYMENT_ATTEMPT", reason); return null;
  }
  await ctx.db.insert("signerLocks", { sender: intent.sender, intentId: intent._id, attemptId: attempt._id });
  await ctx.db.patch(attempt._id, { phase: "PREPARING", claimToken: input.token });
  await ctx.db.patch(intent._id, { status: "SUBMITTING" });
  await event(ctx, job, "PAYMENT_CLAIMED", "Payment preparation claimed. No signing permission yet.");
  return { intent, attempt };
} });
export const signingPermit = internalMutation({ args, handler: async (ctx, input) => {
  const state = await execution(ctx, input);
  if (!state || state.attempt.phase !== "PREPARING") return false;
  const job = await ctx.db.get(state.intent.jobId);
  let reason: string | null = null;
  try {
    reason = !recoveryEnabled() ? "PAYMENT_RECOVERY_DISABLED" : !job ? "JOB_NOT_FOUND" : bindingReason(state.intent, await quote(ctx, job));
    if (!reason && !configuration().enabled) reason = "SETTLEMENT_CONFIGURATION_REQUIRED";
    if (!reason) await enforceAllowance(ctx, state.intent.ownerId);
  } catch { reason = "PAYMENT_POLICY_CHANGED"; }
  if (reason) { await close(ctx, state, reason); return false; }
  await ctx.db.patch(state.attempt._id, { phase: "SIGNING_STARTED", signingStartedAt: Date.now() });
  if (job) await audit(ctx, job, "PAYMENT_SIGNING_PERMIT", "PERMIT_GRANTED_FOR_ATTEMPT_" + state.attempt.generation, "allow");
  return true;
} });
export const prepared = internalMutation({ args: { ...args, txHash: v.string(), nonce: v.string() }, handler: async (ctx, input) => {
  const state = await execution(ctx, input);
  if (!state || state.attempt.phase !== "SIGNING_STARTED" || state.attempt.txHash !== undefined ||
      state.intent.txHash !== undefined || state.intent.nonce !== undefined ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.txHash) || !/^[1-9]\d{0,29}$/.test(input.nonce)) return false;
  // One native transaction cannot settle two obligations, even if a stale RPC
  // offered an already-used nonce/block. Historical v1 identities count too.
  const [hashes, nonces] = await Promise.all([
    ctx.db.query("paymentIntents").withIndex("by_hash", q => q.eq("txHash", input.txHash)).take(1),
    ctx.db.query("paymentIntents").withIndex("by_sender_nonce", q => q.eq("sender", state.intent.sender).eq("nonce", input.nonce)).take(1),
  ]);
  if (hashes.length || nonces.length) {
    const job = await ctx.db.get(state.intent.jobId);
    if (job) await audit(ctx, job, "PAYMENT_IDENTITY_DENIED", "TRANSACTION_IDENTITY_ALREADY_ALLOCATED");
    return false;
  }
  await ctx.db.patch(state.attempt._id, { phase: "SIGNED_IDENTITY", txHash: input.txHash, nonce: input.nonce });
  await ctx.db.patch(state.intent._id, { status: "CONFIRMING", txHash: input.txHash, nonce: input.nonce, lastReason: "SIGNED_NOT_YET_CONFIRMED" });
  const job = await ctx.db.get(state.intent.jobId);
  if (job) await audit(ctx, job, "PAYMENT_IDENTITY_STORED", "SIGNED_IDENTITY_FOR_ATTEMPT_" + state.attempt.generation, "allow");
  return true;
} });
export const broadcastPermit = internalMutation({ args, handler: async (ctx, input) => {
  const state = await execution(ctx, input);
  if (!state || state.attempt.phase !== "SIGNED_IDENTITY" || !state.attempt.txHash || !state.attempt.nonce) return false;
  await ctx.db.patch(state.attempt._id, { phase: "BROADCAST_ADMITTED", broadcastStartedAt: Date.now() });
  const job = await ctx.db.get(state.intent.jobId);
  if (job) await audit(ctx, job, "PAYMENT_BROADCAST_PERMIT", "ONE_BROADCAST_ADMITTED_FOR_ATTEMPT_" + state.attempt.generation, "allow");
  return true;
} });
export const failure = internalMutation({ args: { ...args, reason: v.string() }, handler: async (ctx, input) => {
  const state = await execution(ctx, input);
  if (!state) return;
  if (state.attempt.phase === "PREPARING") {
    await close(ctx, state, preSignReasons.has(input.reason) ? input.reason : "PREPARATION_UNAVAILABLE"); return;
  }
  if (!["SIGNING_STARTED", "SIGNED_IDENTITY", "BROADCAST_ADMITTED", "UNKNOWN_RECONCILE"].includes(state.attempt.phase)) return;
  // A permit may have committed even when its caller lost the response. No retry proof.
  const reason = state.attempt.txHash ? "UNCERTAIN_NETWORK_OUTCOME" : "SIGNING_STARTED_OPERATOR_REVIEW_REQUIRED";
  await ctx.db.patch(state.attempt._id, { phase: "UNKNOWN_RECONCILE", lastReason: reason });
  await ctx.db.patch(state.intent._id, { status: "UNKNOWN_RECONCILE", lastReason: reason });
  const job = await ctx.db.get(state.intent.jobId);
  if (job) { await audit(ctx, job, "PAYMENT_ATTEMPT_UNCERTAIN", reason); await event(ctx, job, "PAYMENT_UNKNOWN_RECONCILE", reason); }
} });
export const outcome = internalMutation({ args: { ...args, receiptJson: v.optional(v.string()) }, handler: async (ctx, input) => {
  const state = await execution(ctx, input);
  if (!state || !["SIGNED_IDENTITY", "BROADCAST_ADMITTED", "UNKNOWN_RECONCILE"].includes(state.attempt.phase)) return;
  let result: { status: "CONFIRMED" | "FAILED" | "UNKNOWN_RECONCILE"; reason: string; blockHash?: string } = { status: "UNKNOWN_RECONCILE", reason: "UNCERTAIN_NETWORK_OUTCOME" };
  if (input.receiptJson && input.receiptJson.length <= 131072 && state.attempt.txHash && state.attempt.nonce) {
    try { result = inspectReceipt(JSON.parse(input.receiptJson), { txHash: state.attempt.txHash, nonce: state.attempt.nonce,
      sender: state.attempt.sender, recipient: state.attempt.recipient, amountYocto: state.attempt.amountYocto }); } catch { /* Retain uncertain identity and lock. */ }
  }
  const lastCheckAt = Date.now();
  await ctx.db.patch(state.attempt._id, { phase: result.status, lastReason: result.reason, lastCheckAt,
    ...(result.blockHash ? { blockHash: result.blockHash } : {}) });
  await ctx.db.patch(state.intent._id, { status: result.status, lastReason: result.reason, lastCheckAt,
    ...(result.blockHash ? { blockHash: result.blockHash } : {}) });
  const job = await ctx.db.get(state.intent.jobId);
  if (job) { await event(ctx, job, "PAYMENT_" + result.status, result.reason); await audit(ctx, job, "CHAIN_RESULT", result.reason, result.status === "CONFIRMED" ? "allow" : "reject"); }
  if (job && result.status === "CONFIRMED") await recordDeliveryRelease(ctx, job);
  if (result.status !== "UNKNOWN_RECONCILE") await ctx.db.delete(state.lock._id);
} });

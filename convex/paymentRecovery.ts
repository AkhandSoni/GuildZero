import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { user, ownedJob } from "./ownership";
import { quote, bindingReason, audit } from "./paymentHelpers";
import { authorizeAllowance } from "./allowanceHelpers";
import { configuration } from "../lib/settlement/policy";
import { event } from "./workflowHelpers";
import { appendAttempt, currentAttempt, hasPreSignClosure, recoveryEnabled, validAttemptHistory, MAX_PAYMENT_ATTEMPTS } from "./paymentRecoveryHelpers";

export const prepareRetry = mutation({
  args: { intentId: v.id("paymentIntents"), attemptId: v.id("paymentAttempts"), generation: v.number(),
    recipient: v.string(), amountYocto: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx), intent = await ctx.db.get(args.intentId);
    if (!intent || intent.ownerId !== ownerId) throw new ConvexError("PAYMENT_NOT_FOUND");
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(args.requestId)) throw new ConvexError("INVALID_RECOVERY_REQUEST");
    const fingerprint = JSON.stringify([args.intentId, args.attemptId, args.generation, args.recipient, args.amountYocto]);
    const previous = await ctx.db.query("paymentRecoveryRequests").withIndex("by_owner_request", q => q.eq("ownerId", ownerId).eq("requestId", args.requestId)).unique();
    if (previous) return previous.fingerprint === fingerprint
      ? { ok: true as const, attemptId: previous.createdAttemptId }
      : { ok: false as const, code: "RECOVERY_REQUEST_CONFLICT" };
    const job = await ownedJob(ctx, intent.jobId);
    const deny = async (code: string) => { await audit(ctx, job, "PREPARE_PAYMENT_RETRY", code); return { ok: false as const, code }; };
    if (!recoveryEnabled()) return deny("PAYMENT_RECOVERY_DISABLED");
    const attempt = await currentAttempt(ctx, intent);
    if (!attempt || attempt._id !== args.attemptId || attempt.generation !== args.generation ||
        intent.status !== "FAILED" || !hasPreSignClosure(attempt) || intent.txHash !== undefined ||
        intent.nonce !== undefined || intent.blockHash !== undefined) return deny("PAYMENT_RETRY_NOT_PROVEN_SAFE");
    if (intent.recipient !== args.recipient || intent.amountYocto !== args.amountYocto) return deny("RECOVERY_BINDING_CHANGED");
    const history = await ctx.db.query("paymentAttempts").withIndex("by_intent", q => q.eq("intentId", intent._id)).take(MAX_PAYMENT_ATTEMPTS + 1);
    if (!validAttemptHistory(history, intent)) return deny("PAYMENT_ATTEMPT_HISTORY_INVALID");
    if (history.length >= MAX_PAYMENT_ATTEMPTS) return deny("PAYMENT_RETRY_LIMIT_REACHED");
    if (intent.lastRecoveryAt && Date.now() - intent.lastRecoveryAt < 15000) return deny("PAYMENT_RECOVERY_RATE_LIMIT");
    if (await ctx.db.query("signerLocks").withIndex("by_sender", q => q.eq("sender", intent.sender)).unique()) return deny("SIGNER_BUSY_REAUTHORIZE_LATER");
    try {
      const reason = bindingReason(intent, await quote(ctx, job));
      if (reason) return deny(reason);
      if (!configuration().enabled) return deny("SETTLEMENT_CONFIGURATION_REQUIRED");
      await authorizeAllowance(ctx, intent);
    } catch { return deny("PAYMENT_POLICY_CHANGED"); }
    const newAttempt = await appendAttempt(ctx, intent, attempt.generation + 1);
    await ctx.db.insert("paymentRecoveryRequests", { ownerId, requestId: args.requestId, fingerprint,
      intentId: intent._id, failedAttemptId: attempt._id, createdAttemptId: newAttempt, createdAt: Date.now() });
    // This is the projection of a NEW attempt. The old closed row is immutable.
    // No scheduled action or payment authority is created by replacement.
    await ctx.db.patch(intent._id, { currentAttemptId: newAttempt, attemptCount: attempt.generation + 1,
      status: "READY", authorizedAt: undefined, txHash: undefined, nonce: undefined, blockHash: undefined,
      lastCheckAt: undefined, lastReason: "OWNER_RETRY_PREPARED", lastRecoveryAt: Date.now() });
    await audit(ctx, job, "PREPARE_PAYMENT_RETRY", "VERIFIED_PRE_SIGN_REPLACEMENT_PREPARED", "allow");
    await event(ctx, job, "PAYMENT_RETRY_PREPARED", "Attempt " + (attempt.generation + 1) + " prepared for your separate approval. No payment was sent.");
    return { ok: true as const, attemptId: newAttempt };
  },
});

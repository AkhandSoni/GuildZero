import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { user, ownedJob } from "./ownership";
import { audit, quote, bindingReason } from "./paymentHelpers";
import { authorizeAllowance, allowanceSnapshot } from "./allowanceHelpers";
import { allowanceRequired } from "../lib/settlement/allowance";
import { configuration, candidateReason } from "../lib/settlement/policy";
import { appendAttempt, currentAttempt, recoveryEnabled, recoveryProjection } from "./paymentRecoveryHelpers";
export const prepare = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ownedJob(ctx, jobId);
    const old = await ctx.db
      .query("paymentIntents")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .unique();
    if (old) return { ok: true as const, intentId: old._id };
    let q: Awaited<ReturnType<typeof quote>>;
    try { q = await quote(ctx, job); }
    catch (error) {
      const code = error instanceof ConvexError ? String(error.data) : "PAYMENT_CONFIGURATION_OR_POLICY";
      await audit(ctx, job, "PREPARE_PAYMENT", code);
      return { ok: false as const, code };
    }
    // Once writes begin, let failures abort the entire mutation. In particular,
    // an attempt write must not leave an orphaned stable intent behind.
    const intentId = await ctx.db.insert("paymentIntents", {
      ...(recoveryEnabled() ? { recoveryVersion: 2 as const } : {}),
      ownerId: job.ownerId,
      jobId,
      contractId: q.contract._id,
      policyVersion: q.policyVersion,
      deliverableId: q.deliverableId,
      verificationId: q.verificationId,
      ...(q.disputeId ? { disputeId: q.disputeId } : {}),
      sender: q.sender,
      recipient: q.recipient,
      amountYocto: q.amountYocto,
      network: "testnet",
      status: "READY",
      createdAt: Date.now(),
    });
    if (recoveryEnabled()) {
      const attemptId = await appendAttempt(ctx, (await ctx.db.get(intentId))!, 1);
      await ctx.db.patch(intentId, { currentAttemptId: attemptId, attemptCount: 1 });
    }
    await audit(
      ctx,
      job,
      "PREPARE_PAYMENT",
      "EXACT_TRANSFER_PREPARED",
      "allow",
    );
    return { ok: true as const, intentId };
  },
});
export const authorize = mutation({
  args: {
    intentId: v.id("paymentIntents"),
    recipient: v.string(),
    amountYocto: v.string(),
    attemptId: v.optional(v.id("paymentAttempts")),
  },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx),
      intent = await ctx.db.get(args.intentId);
    if (!intent || intent.ownerId !== ownerId)
      throw new ConvexError("PAYMENT_NOT_FOUND");
    const job = await ownedJob(ctx, intent.jobId);
    let code = candidateReason(intent, args) ?? "";
    const attempt = intent.recoveryVersion === 2 ? await currentAttempt(ctx, intent) : null;
    if (!code && intent.recoveryVersion === 2 && !recoveryEnabled()) code = "PAYMENT_RECOVERY_DISABLED";
    if (!code && (intent.recoveryVersion === 2
      ? !attempt || attempt.phase !== "READY" || args.attemptId !== attempt._id
      : args.attemptId !== undefined)) code = "PAYMENT_ATTEMPT_CHANGED";
    if (!code)
      try {
        const q = await quote(ctx, job);
        code = bindingReason(intent, q) ?? "";
        if (!code && !configuration().enabled)
          code = "SETTLEMENT_CONFIGURATION_REQUIRED";
      } catch {
        code = "PAYMENT_POLICY_CHANGED";
      }
    if (code) {
      await audit(ctx, job, "AUTHORIZE_PAYMENT", code);
      return { ok: false as const, code };
    }
    if (intent.authorizedAt) {
      await audit(ctx, job, "AUTHORIZE_PAYMENT", "ALREADY_AUTHORIZED");
      return { ok: false as const, code: "ALREADY_AUTHORIZED" };
    }
    try { await authorizeAllowance(ctx, intent); }
    catch (error) {
      const code = error instanceof ConvexError ? String(error.data) : "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED";
      await audit(ctx, job, "AUTHORIZE_PAYMENT", code);
      return { ok: false as const, code };
    }
    const authorizedAt = Date.now();
    await ctx.db.patch(intent._id, { authorizedAt });
    if (attempt) await ctx.db.patch(attempt._id, { authorizedAt });
    await audit(
      ctx,
      job,
      "AUTHORIZE_PAYMENT",
      "EXACT_TRANSFER_OWNER_APPROVED",
      "allow",
    );
    if (attempt) await ctx.scheduler.runAfter(0, internal.nearRecovery.settle, { attemptId: attempt._id });
    else await ctx.scheduler.runAfter(0, internal.nearSettlement.settle, { intentId: intent._id });
    return { ok: true as const };
  },
});
export const forJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ownedJob(ctx, jobId);
    const intent = await ctx.db
      .query("paymentIntents")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .unique();
    return intent ? { ...intent, recovery: await recoveryProjection(ctx, intent) } : null;
  },
});
export const reconcile = mutation({
  args: { intentId: v.id("paymentIntents") },
  handler: async (ctx, { intentId }) => {
    const ownerId = await user(ctx),
      intent = await ctx.db.get(intentId);
    if (!intent || intent.ownerId !== ownerId)
      throw new ConvexError("PAYMENT_NOT_FOUND");
    if (
      !intent.txHash ||
      !["CONFIRMING", "UNKNOWN_RECONCILE"].includes(intent.status)
    )
      throw new ConvexError("NOT_RECONCILABLE");
    if (intent.lastCheckAt && Date.now() - intent.lastCheckAt < 15000)
      throw new ConvexError("CHECK_RATE_LIMIT");
    await ctx.db.patch(intentId, { lastCheckAt: Date.now() });
    if (intent.recoveryVersion === 2 && intent.currentAttemptId)
      await ctx.scheduler.runAfter(0, internal.nearRecovery.reconcile, { attemptId: intent.currentAttemptId });
    else await ctx.scheduler.runAfter(0, internal.nearSettlement.reconcile, { intentId });
    return { ok: true };
  },
});
export const status = query({
  args: {},
  handler: async (ctx) => {
    await user(ctx);
    try {
      return { enabled: configuration().enabled, network: "testnet" as const };
    } catch {
      return { enabled: false, network: "testnet" as const };
    }
  },
});

// Personal figures only: global obligations and other owners remain private.
export const allowance = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await user(ctx);
    if (!allowanceRequired()) return { required: false as const, configured: false as const };
    try {
      const s = await allowanceSnapshot(ctx, ownerId);
      return { required: true as const, configured: true as const, limitYocto: s.personalLimit.toString(), obligatedYocto: s.ownerUsed.toString(), remainingYocto: (s.personalLimit > s.ownerUsed ? s.personalLimit - s.ownerUsed : 0n).toString() };
    } catch (error) {
      return { required: true as const, configured: false as const, code: error instanceof ConvexError ? String(error.data) : "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED" };
    }
  },
});

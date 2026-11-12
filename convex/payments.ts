import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { user, ownedJob } from "./ownership";
import { audit, quote, bindingReason } from "./paymentHelpers";
import { configuration, candidateReason } from "../lib/settlement/policy";
export const prepare = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ownedJob(ctx, jobId);
    const old = await ctx.db
      .query("paymentIntents")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .unique();
    if (old) return { ok: true as const, intentId: old._id };
    try {
      const q = await quote(ctx, job);
      const intentId = await ctx.db.insert("paymentIntents", {
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
      await audit(
        ctx,
        job,
        "PREPARE_PAYMENT",
        "EXACT_TRANSFER_PREPARED",
        "allow",
      );
      return { ok: true as const, intentId };
    } catch (error) {
      const code =
        error instanceof ConvexError
          ? String(error.data)
          : "PAYMENT_CONFIGURATION_OR_POLICY";
      await audit(ctx, job, "PREPARE_PAYMENT", code);
      return { ok: false as const, code };
    }
  },
});
export const authorize = mutation({
  args: {
    intentId: v.id("paymentIntents"),
    recipient: v.string(),
    amountYocto: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx),
      intent = await ctx.db.get(args.intentId);
    if (!intent || intent.ownerId !== ownerId)
      throw new ConvexError("PAYMENT_NOT_FOUND");
    const job = await ownedJob(ctx, intent.jobId);
    let code = candidateReason(intent, args) ?? "";
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
    await ctx.db.patch(intent._id, { authorizedAt: Date.now() });
    await audit(
      ctx,
      job,
      "AUTHORIZE_PAYMENT",
      "EXACT_TRANSFER_OWNER_APPROVED",
      "allow",
    );
    await ctx.scheduler.runAfter(0, internal.nearSettlement.settle, {
      intentId: intent._id,
    });
    return { ok: true as const };
  },
});
export const forJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ownedJob(ctx, jobId);
    return ctx.db
      .query("paymentIntents")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .unique();
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
    await ctx.scheduler.runAfter(0, internal.nearSettlement.reconcile, {
      intentId,
    });
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

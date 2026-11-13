import { recordDeliveryRelease } from "./deliveryAccess";
import { internalMutation, internalQuery } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { enforceAllowance } from "./allowanceHelpers";
import { quote, audit, bindingReason } from "./paymentHelpers";
import { inspectReceipt } from "../lib/settlement/policy";
import { preparationReason } from "../lib/settlement/failures";
import { event } from "./workflowHelpers";
export const snapshot = internalQuery({
  args: { intentId: v.id("paymentIntents") },
  handler: (ctx, { intentId }) => ctx.db.get(intentId),
});
export const claim = internalMutation({
  args: { intentId: v.id("paymentIntents") },
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.db.get(intentId);
    if (!intent || intent.status !== "READY" || !intent.authorizedAt)
      return null;
    const job = await ctx.db.get(intent.jobId);
    if (!job) throw new ConvexError("JOB_NOT_FOUND");
    let reason: string | null;
    try {
      reason = bindingReason(intent, await quote(ctx, job));
      if (!reason) await enforceAllowance(ctx, intent.ownerId);
    } catch (error) {
      reason = error instanceof ConvexError && typeof error.data === "string"
        ? error.data : "PAYMENT_POLICY_CHANGED";
    }
    if (reason) {
      // Return rather than throw so the denial/audit write is retained.
      await audit(ctx, job, "CLAIM_PAYMENT", reason);
      await ctx.db.patch(intentId, { authorizedAt: undefined, lastReason: reason });
      return null;
    }
    if (
      await ctx.db
        .query("signerLocks")
        .withIndex("by_sender", (q) => q.eq("sender", intent.sender))
        .unique()
    ) {
      await ctx.db.patch(intentId, {
        authorizedAt: undefined,
        lastReason: "SIGNER_BUSY_REAUTHORIZE_LATER",
      });
      return null;
    }
    await ctx.db.insert("signerLocks", { sender: intent.sender, intentId });
    await ctx.db.patch(intentId, { status: "SUBMITTING" });
    await event(
      ctx,
      job,
      "PAYMENT_CLAIMED",
      "Custodial testnet payment claimed. No confirmation yet.",
    );
    return intent;
  },
});
export const prepared = internalMutation({
  args: {
    intentId: v.id("paymentIntents"),
    txHash: v.string(),
    nonce: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.status !== "SUBMITTING" || intent.txHash)
      throw new ConvexError("INVALID_PAYMENT_STATE");
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.txHash) ||
      !/^\d{1,30}$/.test(args.nonce)
    )
      throw new ConvexError("INVALID_TRANSACTION_METADATA");
    await ctx.db.patch(intent._id, {
      txHash: args.txHash,
      nonce: args.nonce,
      status: "CONFIRMING",
      lastReason: "SIGNED_NOT_YET_CONFIRMED",
    });
  },
});
export const outcome = internalMutation({
  args: {
    intentId: v.id("paymentIntents"),
    receiptJson: v.optional(v.string()),
    preBroadcastFailure: v.optional(v.boolean()),
    preBroadcastReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      !intent ||
      !["SUBMITTING", "CONFIRMING", "UNKNOWN_RECONCILE"].includes(intent.status)
    )
      return;
    let result: {
      status: "CONFIRMED" | "FAILED" | "UNKNOWN_RECONCILE";
      reason: string;
      blockHash?: string;
    } = { status: "UNKNOWN_RECONCILE", reason: "UNCERTAIN_NETWORK_OUTCOME" };
    if (args.preBroadcastFailure)
      result = { status: "FAILED", reason: preparationReason(args.preBroadcastReason) };
    else if (
      args.receiptJson &&
      args.receiptJson.length <= 131072 &&
      intent.txHash &&
      intent.nonce
    )
      try {
        result = inspectReceipt(JSON.parse(args.receiptJson), {
          txHash: intent.txHash,
          sender: intent.sender,
          recipient: intent.recipient,
          amountYocto: intent.amountYocto,
          nonce: intent.nonce,
        });
      } catch {
        /* Unparseable evidence remains uncertain. */
      }
    await ctx.db.patch(intent._id, {
      status: result.status,
      lastReason: result.reason,
      lastCheckAt: Date.now(),
      ...(result.blockHash ? { blockHash: result.blockHash } : {}),
    });
    const job = await ctx.db.get(intent.jobId);
    if (job) {
      await event(ctx, job, `PAYMENT_${result.status}`, result.reason);
      await audit(
        ctx,
        job,
        "CHAIN_RESULT",
        result.reason,
        result.status === "CONFIRMED" ? "allow" : "reject",
      );
    }
    if (job && result.status === "CONFIRMED") await recordDeliveryRelease(ctx, job);
    if (result.status === "CONFIRMED" || result.status === "FAILED") {
      const lock = await ctx.db
        .query("signerLocks")
        .withIndex("by_sender", (q) => q.eq("sender", intent.sender))
        .unique();
      if (lock?.intentId === intent._id) await ctx.db.delete(lock._id);
    }
  },
});

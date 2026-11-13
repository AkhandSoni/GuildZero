"use node";
import {
  Account,
  KeyPairSigner,
  actions,
  baseEncode,
  type KeyPairString,
} from "near-api-js";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { configuration } from "../lib/settlement/policy";
import { assertTestnet, rpc } from "../lib/settlement/rpc";
import type { PreparationFailure } from "../lib/settlement/failures";
import { settlementProvider } from "../lib/settlement/provider";
export const settle = internalAction({
  args: { intentId: v.id("paymentIntents") },
  handler: async (ctx, { intentId }) => {
    let config;
    try {
      config = configuration();
    } catch {
      return { ok: false, code: "CONFIGURATION_REQUIRED" };
    }
    if (!config.enabled) return { ok: false, code: "CONFIGURATION_REQUIRED" };
    const intent = await ctx.runMutation(internal.paymentWorker.claim, {
      intentId,
    });
    if (!intent) return { ok: false, code: "NOT_CLAIMABLE" };
    let broadcasting = false;
    let failureStage: PreparationFailure = "SENDER_CONFIGURATION_CHANGED";
    try {
      if (config.sender !== intent.sender) throw new Error("SENDER_CHANGED");
      failureStage = "TESTNET_CHECK_FAILED";
      await assertTestnet();
      failureStage = "OPERATOR_ACCOUNT_LOOKUP_FAILED";
      const balance = await rpc("query", {
        request_type: "view_account",
        account_id: intent.sender,
        finality: "final",
      });
      failureStage = "PROTOCOL_CONFIGURATION_UNAVAILABLE";
      const protocol = await rpc("EXPERIMENTAL_protocol_config", {
        finality: "final",
      });
      const storagePrice = protocol.runtime_config?.storage_amount_per_byte;
      failureStage = "INVALID_BALANCE_EVIDENCE";
      if (typeof storagePrice !== "string" || !/^\d{1,30}$/.test(storagePrice) ||
          typeof balance.amount !== "string" || !/^\d{1,40}$/.test(balance.amount) ||
          !Number.isSafeInteger(balance.storage_usage) || balance.storage_usage < 0)
        throw new Error("INVALID_BALANCE_EVIDENCE");
      failureStage = "INSUFFICIENT_OPERATOR_BALANCE";
      if (BigInt(balance.amount) < BigInt(intent.amountYocto) + BigInt(balance.storage_usage) * BigInt(storagePrice) + 10n ** 22n)
        throw new Error("INSUFFICIENT_OPERATOR_BALANCE");
      failureStage = "RECIPIENT_ACCOUNT_LOOKUP_FAILED";
      // Verify the recipient exists before signing; no arbitrary account creation.
      await rpc("query", {
        request_type: "view_account",
        account_id: intent.recipient,
        finality: "final",
      });
      failureStage = "SIGNER_KEY_INVALID";
      const signer = KeyPairSigner.fromSecretKey(
        process.env.NEAR_PRIVATE_KEY! as KeyPairString,
      );
      const account = new Account(
        intent.sender,
        settlementProvider(),
        signer,
      );
      failureStage = "TRANSACTION_PREPARATION_FAILED";
      const transaction = await account.createTransaction({
        receiverId: intent.recipient,
        actions: [actions.transfer(BigInt(intent.amountYocto))],
        publicKey: await signer.getPublicKey(),
      });
      failureStage = "TRANSACTION_SIGNING_FAILED";
      const signed = await signer.signTransaction(transaction);
      const txHash = baseEncode(signed.txHash);
      failureStage = "TRANSACTION_METADATA_NOT_STORED";
      await ctx.runMutation(internal.paymentWorker.prepared, {
        intentId,
        txHash,
        nonce: transaction.nonce.toString(),
      });
      broadcasting = true; // From this line onward, every exception is uncertain.
      const receipt = await rpc("send_tx", {
        signed_tx_base64: Buffer.from(
          signed.signedTransaction.encode(),
        ).toString("base64"),
        wait_until: "FINAL",
      });
      await ctx.runMutation(internal.paymentWorker.outcome, {
        intentId,
        receiptJson: JSON.stringify(receipt),
      });
      return { ok: true, txHash };
    } catch {
      // Never log an SDK exception: it may contain request/key material. Never resend.
      await ctx.runMutation(internal.paymentWorker.outcome, {
        intentId,
        ...(!broadcasting ? { preBroadcastFailure: true, preBroadcastReason: failureStage } : {}),
      });
      return {
        ok: false,
        code: broadcasting ? "UNKNOWN_RECONCILE" : "PRE_BROADCAST_FAILURE",
      };
    }
  },
});
export const reconcile = internalAction({
  args: { intentId: v.id("paymentIntents") },
  handler: async (ctx, { intentId }) => {
    const intent = await ctx.runQuery(internal.paymentWorker.snapshot, {
      intentId,
    });
    if (
      !intent?.txHash ||
      !["CONFIRMING", "UNKNOWN_RECONCILE"].includes(intent.status)
    )
      return { ok: false };
    try {
      await assertTestnet();
      const receipt = await rpc("tx", {
        tx_hash: intent.txHash,
        sender_account_id: intent.sender,
        wait_until: "FINAL",
      });
      await ctx.runMutation(internal.paymentWorker.outcome, {
        intentId,
        receiptJson: JSON.stringify(receipt),
      });
      return { ok: true };
    } catch {
      await ctx.runMutation(internal.paymentWorker.outcome, { intentId });
      return { ok: false };
    }
  },
});

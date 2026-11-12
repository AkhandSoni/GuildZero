"use node";
import {
  Account,
  JsonRpcProvider,
  KeyPairSigner,
  actions,
  baseEncode,
  type KeyPairString,
} from "near-api-js";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { configuration } from "../lib/settlement/policy";
import { assertTestnet, rpc, TESTNET_RPC } from "../lib/settlement/rpc";
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
    try {
      if (config.sender !== intent.sender) throw new Error("SENDER_CHANGED");
      await assertTestnet();
      const balance = await rpc("query", {
        request_type: "view_account",
        account_id: intent.sender,
        finality: "final",
      });
      const protocol = await rpc("EXPERIMENTAL_protocol_config", {
        finality: "final",
      });
      const storagePrice = protocol.runtime_config?.storage_amount_per_byte;
      if (
        typeof storagePrice !== "string" ||
        !/^\d{1,30}$/.test(storagePrice) ||
        typeof balance.amount !== "string" ||
        !Number.isSafeInteger(balance.storage_usage) ||
        balance.storage_usage < 0 ||
        BigInt(balance.amount) <
          BigInt(intent.amountYocto) +
            BigInt(balance.storage_usage) * BigInt(storagePrice) +
            10n ** 22n
      )
        throw new Error("INSUFFICIENT_OPERATOR_BALANCE");
      // Verify the recipient exists before signing; no arbitrary account creation.
      await rpc("query", {
        request_type: "view_account",
        account_id: intent.recipient,
        finality: "final",
      });
      const signer = KeyPairSigner.fromSecretKey(
        process.env.NEAR_PRIVATE_KEY! as KeyPairString,
      );
      const account = new Account(
        intent.sender,
        new JsonRpcProvider({ url: TESTNET_RPC }),
        signer,
      );
      const transaction = await account.createTransaction({
        receiverId: intent.recipient,
        actions: [actions.transfer(BigInt(intent.amountYocto))],
        publicKey: await signer.getPublicKey(),
      });
      const signed = await signer.signTransaction(transaction);
      const txHash = baseEncode(signed.txHash);
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
        ...(!broadcasting ? { preBroadcastFailure: true } : {}),
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

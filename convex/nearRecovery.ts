"use node";
import { randomBytes } from "node:crypto";
import { Account, KeyPairSigner, actions, baseEncode, type KeyPairString } from "near-api-js";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { configuration, yocto } from "../lib/settlement/policy";
import { assertTestnet, rpc } from "../lib/settlement/rpc";
import { settlementProvider } from "../lib/settlement/provider";
import type { PreparationFailure } from "../lib/settlement/failures";

export const settle = internalAction({ args: { attemptId: v.id("paymentAttempts") }, handler: async (ctx, { attemptId }) => {
  const token = randomBytes(32).toString("hex");
  const input = { attemptId, token };
  const claimed = await ctx.runMutation(internal.paymentRecoveryWorker.claim, input);
  if (!claimed) return { ok: false, code: "NOT_CLAIMABLE" };
  const intent = claimed.intent;
  let stage: PreparationFailure = "SENDER_CONFIGURATION_CHANGED";
  try {
    yocto(intent.amountYocto);
    const config = configuration();
    if (!config.enabled || config.sender !== intent.sender) throw new Error("CONFIGURATION_CHANGED");
    // Recoverable preparation is READ ONLY. No key is parsed or passed to an
    // SDK helper and no transaction is constructed before the signing permit.
    stage = "TESTNET_CHECK_FAILED"; await assertTestnet();
    stage = "OPERATOR_ACCOUNT_LOOKUP_FAILED";
    const balance = await rpc("query", { request_type: "view_account", account_id: intent.sender, finality: "final" });
    stage = "PROTOCOL_CONFIGURATION_UNAVAILABLE";
    const protocol = await rpc("EXPERIMENTAL_protocol_config", { finality: "final" });
    const storagePrice = protocol.runtime_config?.storage_amount_per_byte;
    stage = "INVALID_BALANCE_EVIDENCE";
    if (typeof storagePrice !== "string" || !/^\d{1,30}$/.test(storagePrice) ||
        typeof balance.amount !== "string" || !/^\d{1,40}$/.test(balance.amount) ||
        !Number.isSafeInteger(balance.storage_usage) || balance.storage_usage < 0) throw new Error("BALANCE_INVALID");
    stage = "INSUFFICIENT_OPERATOR_BALANCE";
    if (BigInt(balance.amount) < BigInt(intent.amountYocto) + BigInt(balance.storage_usage) * BigInt(storagePrice) + 10n ** 22n) throw new Error("BALANCE_INSUFFICIENT");
    stage = "RECIPIENT_ACCOUNT_LOOKUP_FAILED";
    await rpc("query", { request_type: "view_account", account_id: intent.recipient, finality: "final" });
    if (!(await ctx.runMutation(internal.paymentRecoveryWorker.signingPermit, input))) return { ok: false, code: "SIGNING_NOT_PERMITTED" };
    // Every SDK helper with access to a signing key belongs AFTER this permit.
    stage = "SIGNER_KEY_INVALID";
    const signer = KeyPairSigner.fromSecretKey(process.env.NEAR_PRIVATE_KEY! as KeyPairString);
    const account = new Account(intent.sender, settlementProvider(), signer);
    stage = "TRANSACTION_PREPARATION_FAILED";
    const transaction = await account.createTransaction({ receiverId: intent.recipient,
      actions: [actions.transfer(BigInt(intent.amountYocto))], publicKey: await signer.getPublicKey() });
    stage = "TRANSACTION_SIGNING_FAILED";
    const signed = await signer.signTransaction(transaction), txHash = baseEncode(signed.txHash);
    stage = "TRANSACTION_METADATA_NOT_STORED";
    if (!(await ctx.runMutation(internal.paymentRecoveryWorker.prepared, { ...input, txHash, nonce: transaction.nonce.toString() }))) throw new Error("IDENTITY_NOT_ADMITTED");
    if (!(await ctx.runMutation(internal.paymentRecoveryWorker.broadcastPermit, input))) throw new Error("BROADCAST_NOT_ADMITTED");
    const receipt = await rpc("send_tx", { signed_tx_base64: Buffer.from(signed.signedTransaction.encode()).toString("base64"), wait_until: "FINAL" });
    await ctx.runMutation(internal.paymentRecoveryWorker.outcome, { ...input, receiptJson: JSON.stringify(receipt) });
    return { ok: true, txHash };
  } catch {
    // The database phase, not an action-local Boolean, determines retry safety.
    // Errors/SDK payloads/keys/tokens are never logged or returned.
    await ctx.runMutation(internal.paymentRecoveryWorker.failure, { ...input, reason: stage });
    return { ok: false, code: "PAYMENT_ATTEMPT_INTERRUPTED" };
  }
} });
export const reconcile = internalAction({ args: { attemptId: v.id("paymentAttempts") }, handler: async (ctx, { attemptId }) => {
  const state = await ctx.runQuery(internal.paymentRecoveryWorker.snapshot, { attemptId });
  if (!state?.attempt.txHash || !state.attempt.claimToken ||
      !["SIGNED_IDENTITY", "BROADCAST_ADMITTED", "UNKNOWN_RECONCILE"].includes(state.attempt.phase)) return { ok: false };
  const input = { attemptId, token: state.attempt.claimToken };
  try {
    await assertTestnet();
    const receipt = await rpc("tx", { tx_hash: state.attempt.txHash, sender_account_id: state.attempt.sender, wait_until: "FINAL" });
    await ctx.runMutation(internal.paymentRecoveryWorker.outcome, { ...input, receiptJson: JSON.stringify(receipt) });
    return { ok: true };
  } catch {
    await ctx.runMutation(internal.paymentRecoveryWorker.outcome, input);
    return { ok: false };
  }
} });

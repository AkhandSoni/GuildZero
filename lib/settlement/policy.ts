export const PAYMENT_CAP = 10n ** 24n;
export function candidateReason(
  expected: { recipient: string; amountYocto: string; status: string },
  candidate: { recipient: string; amountYocto: string },
) {
  if (expected.status !== "READY") return "DUPLICATE_OR_UNCERTAIN_PAYMENT";
  if (candidate.recipient !== expected.recipient)
    return "RECIPIENT_SUBSTITUTION";
  if (candidate.amountYocto !== expected.amountYocto)
    return "AMOUNT_SUBSTITUTION";
  return null;
}
export function subcontractReason(
  depth: number,
  price: string,
  budget: string,
) {
  if (depth !== 0) return "SUBCONTRACT_DEPTH_LIMIT";
  if (!/^[1-9]\d{0,27}$/.test(price) || !/^[1-9]\d{0,27}$/.test(budget))
    return "INVALID_SUBCONTRACT_AMOUNT";
  return BigInt(price) >= BigInt(budget) ? "SUBCONTRACT_OVER_BUDGET" : null;
}
export function reputationWriteAllowed(
  role: "human" | "untrusted_agent" | "verified_workflow",
) {
  return role === "verified_workflow";
}
export function testnetAccount(value: string) {
  return (
    value.length >= 8 &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.testnet$/.test(
      value,
    )
  );
}
export function yocto(value: string) {
  if (!/^[1-9]\d{0,24}$/.test(value)) throw new Error("INVALID_AMOUNT");
  const n = BigInt(value);
  if (n > PAYMENT_CAP) throw new Error("PAYMENT_CAP");
  return n;
}
export function configuration() {
  const sender = process.env.NEAR_OPERATOR_ACCOUNT_ID ?? "";
  const entries: unknown = JSON.parse(
    process.env.NEAR_AGENT_RECIPIENTS_JSON ?? "{}",
  );
  if (
    !entries ||
    typeof entries !== "object" ||
    Array.isArray(entries) ||
    Object.keys(entries).length > 10
  )
    throw new Error("INVALID_RECIPIENT_CONFIGURATION");
  const recipients = entries as Record<string, unknown>;
  return {
    sender,
    recipients,
    enabled:
      process.env.NEAR_SETTLEMENT_ENABLED === "true" &&
      process.env.NEAR_NETWORK === "testnet" &&
      testnetAccount(sender) &&
      Boolean(process.env.NEAR_PRIVATE_KEY),
  };
}
export type ExpectedTransfer = {
  txHash: string;
  sender: string;
  recipient: string;
  amountYocto: string;
  nonce: string;
};
function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
export function inspectReceipt(
  raw: unknown,
  expected: ExpectedTransfer,
): {
  status: "CONFIRMED" | "FAILED" | "UNKNOWN_RECONCILE";
  blockHash?: string;
  reason: string;
} {
  const result = record(raw),
    tx = record(result?.transaction);
  const actions = tx?.actions;
  const transfer =
    Array.isArray(actions) && actions.length === 1
      ? record(record(actions[0])?.Transfer)
      : null;
  const nonce =
    typeof tx?.nonce === "string"
      ? tx.nonce
      : typeof tx?.nonce === "number" && Number.isSafeInteger(tx.nonce)
        ? String(tx.nonce)
        : null;
  if (
    !tx ||
    tx.hash !== expected.txHash ||
    tx.signer_id !== expected.sender ||
    tx.receiver_id !== expected.recipient ||
    transfer?.deposit !== expected.amountYocto ||
    nonce !== expected.nonce
  )
    return { status: "UNKNOWN_RECONCILE", reason: "RECEIPT_BINDING_MISMATCH" };
  if (result?.final_execution_status !== "FINAL")
    return { status: "UNKNOWN_RECONCILE", reason: "NOT_FINAL" };
  const blockHash = record(result.transaction_outcome)?.block_hash;
  if (
    typeof blockHash !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(blockHash)
  )
    return { status: "UNKNOWN_RECONCILE", reason: "MISSING_BLOCK_REFERENCE" };
  const status = record(result.status),
    receipts = result.receipts_outcome;
  if (
    !status ||
    !Array.isArray(receipts) ||
    !receipts.length ||
    receipts.length > 50
  )
    return { status: "UNKNOWN_RECONCILE", reason: "INCOMPLETE_RECEIPTS" };
  if ("Failure" in status)
    return { status: "FAILED", blockHash, reason: "FINAL_CHAIN_FAILURE" };
  const outcomes = receipts
    .map((r) => record(record(r)?.outcome)?.status)
    .map(record);
  if (
    !("SuccessValue" in status) ||
    outcomes.some(
      (o) =>
        !o ||
        (!("SuccessValue" in o) && !("SuccessReceiptId" in o)) ||
        "Failure" in o,
    )
  )
    return { status: "UNKNOWN_RECONCILE", reason: "INCONSISTENT_RECEIPTS" };
  return { status: "CONFIRMED", blockHash, reason: "FINAL_MATCHING_TRANSFER" };
}

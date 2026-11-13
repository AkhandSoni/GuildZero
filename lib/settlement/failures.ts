export const preparationFailures = {
  SENDER_CONFIGURATION_CHANGED: "The operator account changed after this payment was prepared.",
  TESTNET_CHECK_FAILED: "The network could not be verified as NEAR testnet.",
  OPERATOR_ACCOUNT_LOOKUP_FAILED: "The operator account could not be read from testnet.",
  PROTOCOL_CONFIGURATION_UNAVAILABLE: "Testnet storage-cost information was unavailable.",
  INVALID_BALANCE_EVIDENCE: "The account balance or storage-cost information could not be validated.",
  INSUFFICIENT_OPERATOR_BALANCE: "The operator balance does not cover this transfer, storage and the gas reserve.",
  RECIPIENT_ACCOUNT_LOOKUP_FAILED: "The recipient account could not be read from testnet.",
  SIGNER_KEY_INVALID: "The operator signing configuration could not be loaded.",
  TRANSACTION_PREPARATION_FAILED: "The account access key, nonce or recent block could not be prepared.",
  TRANSACTION_SIGNING_FAILED: "The transaction could not be signed by the configured operator.",
  TRANSACTION_METADATA_NOT_STORED: "The transaction identity could not be stored safely before sending.",
} as const;
export type PreparationFailure = keyof typeof preparationFailures;
const prefix = "PROVEN_PRE_BROADCAST_FAILURE";
export function preparationReason(code?: string) {
  return code && Object.hasOwn(preparationFailures, code) ? `${prefix}:${code}` : prefix;
}
export function isPreBroadcastFailure(reason?: string) {
  return reason === prefix || reason?.startsWith(`${prefix}:`) === true;
}
export function paymentFailureMessage(reason?: string) {
  if (reason === prefix) return "Preparation failed before sending. The exact step was not recorded for this older attempt.";
  if (!reason?.startsWith(`${prefix}:`)) return null;
  const code = reason.slice(prefix.length+1);
  return Object.hasOwn(preparationFailures,code) ? preparationFailures[code as PreparationFailure] : "Preparation failed before sending.";
}

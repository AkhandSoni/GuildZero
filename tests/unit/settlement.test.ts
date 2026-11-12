import { expect, it } from "vitest";
import {
  candidateReason,
  inspectReceipt,
  testnetAccount,
  yocto,
} from "../../lib/settlement/policy";
const expected = {
  txHash: "1".repeat(32),
  sender: "operator.testnet",
  recipient: "worker.testnet",
  amountYocto: "100000000000000000000000",
  nonce: "7",
};
const receipt = () => ({
  final_execution_status: "FINAL",
  transaction: {
    hash: expected.txHash,
    signer_id: expected.sender,
    receiver_id: expected.recipient,
    nonce: 7,
    actions: [{ Transfer: { deposit: expected.amountYocto } }],
  },
  transaction_outcome: { block_hash: "2".repeat(44) },
  status: { SuccessValue: "" },
  receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
});
it("accepts only named testnet accounts and caps money precisely", () => {
  expect(testnetAccount("worker.testnet")).toBe(true);
  expect(testnetAccount("worker.near")).toBe(false);
  expect(testnetAccount("https://worker.testnet")).toBe(false);
  expect(yocto("1")).toBe(1n);
  for (const value of ["0", "01", "1.5", "1000000000000000000000001", "1e24"])
    expect(() => yocto(value)).toThrow();
});
it("checks exact financial and recipient binding before signing", () => {
  const e = { ...expected, status: "READY" };
  expect(candidateReason(e, e)).toBe(null);
  expect(candidateReason(e, { ...e, recipient: "other.testnet" })).toBe(
    "RECIPIENT_SUBSTITUTION",
  );
  expect(candidateReason(e, { ...e, amountYocto: "1" })).toBe(
    "AMOUNT_SUBSTITUTION",
  );
  expect(candidateReason({ ...e, status: "UNKNOWN_RECONCILE" }, e)).toBe(
    "DUPLICATE_OR_UNCERTAIN_PAYMENT",
  );
});
it("confirms only a FINAL matching native transfer with receipt outcomes", () => {
  expect(inspectReceipt(receipt(), expected).status).toBe("CONFIRMED");
});
it.each(["sender", "recipient", "amountYocto", "txHash", "nonce"] as const)(
  "rejects substituted receipt binding: %s",
  (field) => {
    expect(
      inspectReceipt(receipt(), { ...expected, [field]: "different" }).status,
    ).toBe("UNKNOWN_RECONCILE");
  },
);
it("retains uncertain accounting for missing or optimistic execution evidence", () => {
  expect(
    inspectReceipt(
      { ...receipt(), final_execution_status: "EXECUTED_OPTIMISTIC" },
      expected,
    ).status,
  ).toBe("UNKNOWN_RECONCILE");
  expect(
    inspectReceipt({ ...receipt(), receipts_outcome: [] }, expected).status,
  ).toBe("UNKNOWN_RECONCILE");
  expect(
    inspectReceipt(
      {
        ...receipt(),
        receipts_outcome: [{ outcome: { status: { Failure: {} } } }],
      },
      expected,
    ).status,
  ).toBe("UNKNOWN_RECONCILE");
  expect(inspectReceipt(null, expected).status).toBe("UNKNOWN_RECONCILE");
});
it("recognizes a final bound failed transfer without marking it successful", () => {
  expect(
    inspectReceipt(
      { ...receipt(), status: { Failure: { error_message: "fixture" } } },
      expected,
    ).status,
  ).toBe("FAILED");
});

import { expect, it } from "vitest";
import { RecoveryProtocolModel } from "../models/payment-recovery-model";
const checks = { owner: true, binding: true, allowance: true, signerClear: true };
function claimed() { const m = new RecoveryProtocolModel(); expect(m.authorize(1, checks)).toBe(true); return m; }
it("makes closing and signing mutually exclusive for both mutation orders", () => {
  for (const first of ["SIGNING_STARTED", "CLOSED_PRE_SIGN_FAILURE"] as const) {
    const m = claimed();
    expect(m.transition(1, "server-claim-1", "PREPARING", first)).toBe(true);
    const second = first === "SIGNING_STARTED" ? "CLOSED_PRE_SIGN_FAILURE" : "SIGNING_STARTED";
    expect(m.transition(1, "server-claim-1", "PREPARING", second)).toBe(false);
    expect(m.replace(1, checks)).toBe(first === "CLOSED_PRE_SIGN_FAILURE");
  }
});
it("fences every stale callback and duplicate replacement after closure", () => {
  const m = claimed();
  m.transition(1, "server-claim-1", "PREPARING", "CLOSED_PRE_SIGN_FAILURE");
  expect(m.replace(1, checks)).toBe(true);
  expect(m.current.phase).toBe("READY");
  expect(m.transition(2, "server-claim-2", "PREPARING", "SIGNING_STARTED")).toBe(false);
  expect(m.authorize(2, checks)).toBe(true);
  for (const phase of ["SIGNING_STARTED", "SIGNED_IDENTITY", "BROADCAST_ADMITTED", "CLOSED_PRE_SIGN_FAILURE"] as const)
    expect(m.transition(1, "server-claim-1", "PREPARING", phase)).toBe(false);
  expect(m.replace(1, checks)).toBe(false);
  expect(m.history[0]).toEqual({ generation: 1, token: "server-claim-1", phase: "CLOSED_PRE_SIGN_FAILURE", replaced: true });
});
it("denies all proposed recovery gates independently", () => {
  for (const key of Object.keys(checks)) {
    const m = claimed();
    m.transition(1, "server-claim-1", "PREPARING", "CLOSED_PRE_SIGN_FAILURE");
    expect(m.replace(1, { ...checks, [key]: false })).toBe(false);
    expect(m.history).toHaveLength(0);
  }
});
it("never recovers after signing permission, identity or broadcast admission", () => {
  const m = claimed();
  let from = "PREPARING" as typeof m.current.phase;
  for (const to of ["SIGNING_STARTED", "SIGNED_IDENTITY", "BROADCAST_ADMITTED"] as const) {
    expect(m.transition(1, "server-claim-1", from, to)).toBe(true);
    expect(m.replace(1, checks)).toBe(false);
    expect(m.transition(1, "server-claim-1", to, "CLOSED_PRE_SIGN_FAILURE")).toBe(false);
    from = to;
  }
});
it("fails closed when bounded attempt history is exhausted", () => {
  const m = claimed();
  for (let generation = 1; generation <= 5; generation++) {
    expect(m.transition(generation, `server-claim-${generation}`, "PREPARING", "CLOSED_PRE_SIGN_FAILURE")).toBe(true);
    expect(m.replace(generation, checks)).toBe(generation < 5);
    if (generation < 5) expect(m.authorize(generation + 1, checks)).toBe(true);
  }
  expect(m.history).toHaveLength(4);
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
const fixture = vi.hoisted(() => ({ allowance: { required: false, configured: false } as Record<string, unknown>, intent: { _id: "fixture-intent", status: "READY", recipient: "statistics-worker.guildzero-demo.testnet", amountYocto: "238488096000000000000000" } as Record<string, unknown> }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (reference: FunctionReference<"query">) => {
    const name = getFunctionName(reference);
    if (name === "payments:status") return { enabled: true, network: "testnet" };
    if (name === "payments:allowance") return fixture.allowance;
    if (name === "payments:forJob") return fixture.intent;
    throw Error("Unexpected fixture query");
  },
}));
import { PaymentPanel } from "../../components/payment-panel";
import type { Id } from "../../convex/_generated/dataModel";
afterEach(() => { fixture.allowance = { required: false, configured: false }; fixture.intent = { _id: "fixture-intent", status: "READY", recipient: "statistics-worker.guildzero-demo.testnet", amountYocto: "238488096000000000000000" }; });
const render = () => renderToStaticMarkup(createElement(PaymentPanel, { jobId: "fixture-job" as Id<"jobs">, approved: true }));
it("ready demo receipt enables exact owner authorization without a personal allowance", () => {
  const html = render();
  expect(html).not.toContain("No usable personal allowance");
  expect(html).not.toContain("Operator-managed demo allowance");
  expect(html).toContain("0.238488096");
  expect(html).toContain("receipt-summary");
  expect(html).toContain('type="checkbox" required=""');
  expect(html.match(/<button[^>]*>/)?.[0]).not.toMatch(/\sdisabled(?:=|\s|>)/);
});
it("explicitly enabled operator quotas still block an account missing permission", () => {
  fixture.allowance = { required: true, configured: false };
  const html = render();
  expect(html).toContain("No usable personal allowance");
  expect(html.match(/<button[^>]*>/)?.[0]).toMatch(/\sdisabled(?:=|\s|>)/);
});
it("shows replacement preparation only for the backend-proven pre-sign closure", () => {
  fixture.intent = { ...fixture.intent, status: "FAILED", recovery: { eligible: true, enabled: true, attemptId: "attempt-1", generation: 1, phase: "CLOSED_PRE_SIGN_FAILURE", reason: "VERIFIED_PRE_SIGN_CLOSURE", history: [{ id: "attempt-1", generation: 1, phase: "CLOSED_PRE_SIGN_FAILURE" }] } };
  const html = render();
  expect(html).toContain("Prepare payment retry"); expect(html).toContain("separate approval");
  expect(html).not.toContain("Authorize testnet payment"); expect(html).toContain("Payment attempt history");
});
it("never offers a retry for legacy or uncertain signed attempts", () => {
  fixture.intent = { ...fixture.intent, status: "FAILED", lastReason: "PROVEN_PRE_BROADCAST_FAILURE" };
  expect(render()).not.toContain("Prepare payment retry");
  fixture.intent = { ...fixture.intent, status: "UNKNOWN_RECONCILE", txHash: "1".repeat(32), recovery: { eligible: false, enabled: true, phase: "UNKNOWN_RECONCILE", reason: "PAYMENT_RETRY_NOT_PROVEN_SAFE", history: [] } };
  expect(render()).toContain("Check existing transaction"); expect(render()).not.toContain("Prepare payment retry");
});
it("pauses unapproved v2 authorization when its deployment gate is disabled", () => {
  fixture.intent = { ...fixture.intent, recovery: { eligible: false, enabled: false, phase: "READY", reason: "PAYMENT_RECOVERY_DISABLED", history: [] } };
  const html = render(); expect(html).toContain("Authorize testnet payment"); expect(html.match(/<button[^>]*>/)?.[0]).toMatch(/\sdisabled(?:=|\s|>)/);
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
const fixture = vi.hoisted(() => ({ allowance: { required: false, configured: false } as Record<string, unknown> }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (reference: FunctionReference<"query">) => {
    const name = getFunctionName(reference);
    if (name === "payments:status") return { enabled: true, network: "testnet" };
    if (name === "payments:allowance") return fixture.allowance;
    if (name === "payments:forJob") return { _id: "fixture-intent", status: "READY", recipient: "statistics-worker.guildzero-demo.testnet", amountYocto: "238488096000000000000000" };
    throw Error("Unexpected fixture query");
  },
}));
import { PaymentPanel } from "../../components/payment-panel";
import type { Id } from "../../convex/_generated/dataModel";
afterEach(() => { fixture.allowance = { required: false, configured: false }; });
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

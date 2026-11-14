import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { masterFixture } from "../helpers/master-fixtures";

test("one Start via Enter admits an offline gold plan and runs genuine auctions without another acceptance", async ({ page }) => {
  test.setTimeout(100_000);
  const backendUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? readFileSync(".env.local", "utf8").match(/^NEXT_PUBLIC_CONVEX_URL=["']?([^\s"']+)/m)?.[1];
  if (!backendUrl) throw Error("Configure the isolated test backend public URL.");
  const { context, plan } = masterFixture();
  const captured: { client?: ConvexHttpClient; runId?: Id<"masterRuns"> } = {};
  let planningRequests = 0;
  let pageErrors = 0;
  page.on("pageerror", () => { pageErrors++; });
  // This is explicitly an offline planning fixture. Auth, Start consent, plan
  // admission, auctions, service work, verification and result policy are real.
  await page.route("**/api/master-agent/plan", async route => {
    planningRequests++;
    const auth = route.request().headers().authorization;
    if (!auth?.startsWith("Bearer ")) throw Error("Expected authenticated planning request.");
    const client = new ConvexHttpClient(backendUrl, { logger: false }); client.setAuth(auth.slice(7));
    const input = route.request().postDataJSON() as { runId: Id<"masterRuns">; revision: number };
    captured.client = client; captured.runId = input.runId;
    // Test-only pacing: the actual deployment's global limit is two claims per
    // minute. Space this extra gold fixture from the legacy/MCP gold cases;
    // never weaken production limits or retry an inference/payment request.
    await new Promise(resolve => setTimeout(resolve, 30_500));
    const begun = await client.mutation(api.masterAgent.beginPlanning, input);
    const result = await client.mutation(api.masterAgent.finishPlanning, { ...input, token: begun.token, planJson: JSON.stringify(plan) });
    await route.fulfill({ status: result.ok ? 200 : 422, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in"); await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Email", { exact: true }).fill(`start-${randomBytes(8).toString("hex")}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password); await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "+ New mission", exact: true }).click();
  await page.getByLabel("What should the agents do?", { exact: true }).fill(context.prompt);
  await page.getByLabel("Maximum contract transfers (testnet NEAR)").fill("1");
  await page.getByLabel("Primary CSV file", { exact: true }).setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(context.datasets[0].csv) });
  await page.getByLabel("Payment mode", { exact: true }).selectOption("preview");
  await expect(page.getByLabel("Start authorization", { exact: true })).toContainText("authorizes no payment");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await page.getByLabel("What should the agents do?", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/master-agent\/[a-z0-9]+\?plan=1$/);
  await expect(page.getByRole("button", { name: "Accept plan and start marketplace", exact: true })).toHaveCount(0);
  await expect(page.getByText("Main analysis · Work accepted", { exact: true })).toBeVisible({ timeout: 70_000 });
  await expect(page.getByRole("region", { name: "Started workflow authorization", exact: true })).toContainText("Processing-only preview");
  await expect(page.getByRole("region", { name: "Locked deliverable preview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize this mission bundle", exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
  expect(planningRequests).toBe(1);
  const { client, runId } = captured;
  if (!client || !runId) throw Error("The actual planning fixture did not run.");
  const run = await client.query(api.masterAgent.get, { runId });
  expect(run.steps).toHaveLength(1); expect(run.grant).toBeNull(); expect(run.run.acceptedAt).not.toBeNull();
  const detail = await client.query(api.jobs.detail, { id: run.steps[0].jobId! });
  expect(detail.job.state).toBe("approved"); expect(detail.bids.length).toBeGreaterThanOrEqual(2);
  expect(detail.verifications[0].verdict).toBe("pass"); expect(detail.delivery.released).toBe(false);
  expect(await client.query(api.payments.forJob, { jobId: run.steps[0].jobId! })).toBeNull();
  await page.reload(); await expect(page.getByText("Main analysis · Work accepted", { exact: true })).toBeVisible();
  expect(planningRequests).toBe(1);
  await page.goBack(); await expect(page).toHaveURL(/\/missions\/new$/);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await page.goForward(); await expect(page.getByText("Main analysis · Work accepted", { exact: true })).toBeVisible();
  expect(planningRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toBe(0);
});

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { masterFixture } from "../helpers/master-fixtures";

test("planner saves a private CSV request, reports missing inference configuration and fits mobile", async ({ page }) => {
  // Configuration-error fixture only. This default suite makes no Groq request.
  await page.route("**/api/master-agent/plan", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "GROQ_CONFIGURATION_REQUIRED" }) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in"); await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Email", { exact: true }).fill(`master-${randomBytes(8).toString("hex")}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password); await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Personal planner", exact: true }).click();
  await page.getByLabel("What should the agents do?", { exact: true }).fill("Summarize units and price.");
  await page.getByLabel("Primary CSV file", { exact: true }).setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from("units,price\n3,12.50\n5,4\n") });
  await expect(page.getByRole("region", { name: "Dataset preview", exact: true })).toContainText("2 data rows");
  await page.getByRole("button", { name: "Create planning request", exact: true }).click();
  await expect(page).toHaveURL(/\/master-agent\/[a-z0-9]+\?plan=1$/);
  await expect(page.getByRole("alert").filter({ hasText: "Groq is not configured yet" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Proposed execution plan", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/master-agent"); await expect(page.getByRole("link", { name: "Summarize units and price.", exact: true })).toBeVisible();
});

test("an explicitly labeled offline gold proposal starts actual private auctions and keeps unpaid output locked", async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? readFileSync(".env.local", "utf8").match(/^NEXT_PUBLIC_CONVEX_URL=["']?([^\s"']+)/m)?.[1];
  if (!url) throw Error("Configure the test backend public URL.");
  const client = new ConvexHttpClient(url, { logger: false });
  const email = `master-gold-${randomBytes(8).toString("hex")}@example.com`, password = randomBytes(24).toString("base64url");
  const session = await client.mutation(api.auth.signIn, { flow: "signUp", email, password });
  if (session.status !== "complete") throw Error("Synthetic test session creation failed.");
  client.setAuth(session.tokens.accessToken);
  const { plan, context } = masterFixture();
  const runId = await client.mutation(api.masterAgent.create, { requestId: randomBytes(16).toString("hex"), prompt: context.prompt,
    datasets: context.datasets, capYocto: context.capYocto, deadlineAt: context.deadlineAt, requiresHumanReview: false });
  const claim = await client.mutation(api.masterAgent.beginPlanning, { runId, revision: 1 });
  await client.mutation(api.masterAgent.finishPlanning, { runId, revision: 1, token: claim.token, planJson: JSON.stringify(plan) });
  await page.goto("/sign-in"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/master-agent/${runId}`);
  const proposal = page.getByRole("region", { name: "Proposed execution plan", exact: true });
  await expect(proposal).toContainText("Offline gold proposal");
  await proposal.getByRole("checkbox", { name: /If settlement is unavailable/ }).check();
  await proposal.getByRole("checkbox", { name: /I accept these services/ }).check();
  await proposal.getByRole("button", { name: "Accept plan and start marketplace", exact: true }).click();
  await expect(page.getByText("Main analysis · Work accepted", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("region", { name: "Locked deliverable preview", exact: true })).toBeVisible();
  await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Mission spending authorization", exact: true })).toContainText("Automatic settlement is disabled");
  await page.reload(); await expect(page.getByText("Main analysis · Work accepted", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

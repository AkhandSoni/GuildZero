import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
async function signup(page: Page) {
  await page.goto("/sign-in"); await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page.getByLabel("Email", { exact: true }).fill(`recovery-${randomBytes(8).toString("hex")}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(randomBytes(24).toString("base64url"));
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
}
async function create(page: Page, title: string, csv = "units\n3\n5", budget = "1", human = false) {
  await page.goto("/missions/new"); await page.getByLabel("Mission title").fill(title);
  await page.getByLabel("CSV dataset").fill(csv); await page.getByRole("checkbox", { name: "units", exact: true }).check();
  await page.getByLabel("Maximum budget (testnet NEAR)").fill(budget);
  if (human) await page.getByRole("checkbox", { name: "Require human review of acceptance notes" }).check();
  await page.getByRole("button", { name: "Create private mission" }).click(); await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
  await page.getByRole("button", { name: "Open auction", exact: true }).click();
}
test("human review, invalid input and insufficient budget have actionable outcomes without fake payments", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await signup(page);
  await create(page, "Human acceptance decision", "units\n3\n5", "1", true);
  await expect(page.getByText("Persisted job · disputed", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("heading", { name: "Verification: needs_human" })).toBeVisible();
  await page.getByLabel("Reason", { exact: true }).fill("I checked the actual sums and accept this result.");
  await page.getByRole("combobox", { name: /^Decision/ }).selectOption("approve");
  await page.getByRole("button", { name: "Record final decision" }).click();
  await expect(page.getByText("Persisted job · approved", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await create(page, "Invalid numeric input", "units\nnot-a-number");
  await expect(page.getByText("Persisted job · disputed", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("heading", { name: /Deliverable/ })).toHaveCount(0);
  await page.getByLabel("Reason", { exact: true }).fill("No computed output exists; source needs correcting.");
  await page.getByRole("combobox", { name: /^Decision/ }).selectOption("approve");
  await page.getByRole("button", { name: "Record final decision" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No deliverable exists to approve" })).toBeVisible();
  await page.getByRole("combobox", { name: /^Decision/ }).selectOption("reject"); await page.getByRole("button", { name: "Record final decision" }).click();
  await expect(page.getByText("Persisted job · rejected", { exact: true })).toBeVisible();
  await create(page, "No eligible price", "units\n3\n5", "0.000000000000000000000001");
  await expect(page.getByText("Persisted job · unawarded", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("No offer could be awarded", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Transaction hash/ })).toHaveCount(0);
});

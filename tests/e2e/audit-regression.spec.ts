import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("cancellation-safe output is downloaded and underflow enters review without invented output", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page.getByLabel("Email", { exact: true }).fill(`audit-${randomBytes(8).toString("hex")}@example.com`);
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  async function launch(title: string, csv: string, clean = false) {
    await page.goto("/missions/new");
    await page.getByLabel("Mission title").fill(title);
    await page.getByLabel("CSV dataset").fill(csv);
    await page.getByRole("checkbox", { name: "units", exact: true }).check();
    if (clean) await page.getByRole("checkbox", { name: "Clean before analysis" }).check();
    await page.getByRole("button", { name: "Create private mission" }).click();
    await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
    await page.getByRole("button", { name: "Open auction", exact: true }).click();
  }

  await launch("Cancellation regression", "units\n1000000000000\n0.00001\n-1000000000000");
  await expect(page.getByText("Persisted job · approved", { exact: true })).toBeVisible({ timeout: 25000 });
  await page.reload();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download JSON", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.columns[0].sum).toBeCloseTo(0.00001, 12);
  expect(result.columns[0].mean).toBeCloseTo(0.00001 / 3, 12);

  await launch("Underflow regression", "units\n1e-324");
  await expect(page.getByText("Persisted job · disputed", { exact: true })).toBeVisible({ timeout: 25000 });
  await expect(page.getByText(/Service could not execute: INVALID_NUMBER/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download JSON", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare exact payment", exact: true })).toBeDisabled();

  await launch("Unexecutable dependency regression", "product,units\n=unsafe,3", true);
  await expect(page.getByText("Persisted job · disputed", { exact: true }).first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByText("Required subcontract needs review and has no approvable output", { exact: true })).toBeVisible();
  await page.getByText("Cleaning subcontract · disputed", { exact: true }).click();
  await expect(page.getByText("Persisted job · disputed", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Download JSON", exact: true })).toHaveCount(0);
});

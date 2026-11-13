import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
test("session refresh preserves access after the initial access token expires", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page.getByLabel("Email", { exact: true }).fill(`refresh-${randomBytes(8).toString("hex")}@example.com`);
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // Access tokens expire at 60 seconds. Exercise the real refresh and reload.
  await page.waitForTimeout(70000);
  await page.reload();
  await expect(page.getByRole("button", { name: "Add sample missions", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

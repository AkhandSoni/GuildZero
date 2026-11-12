import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
test("owner opens, reloads and cancels a persisted auction without fabricated worker activity", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`auction-${randomBytes(8).toString("hex")}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(randomBytes(24).toString("base64url"));
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "+ New mission" }).click();
  await page.getByLabel("Mission title").fill("Auction persistence test");
  await page.getByRole("button", { name: "Use synthetic sample CSV" }).click();
  await page.getByRole("button", { name: "Create private mission" }).click();
  await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
  await page.getByRole("button", { name: "Open auction", exact: true }).click();
  await expect(
    page.getByText("INVALID_COLUMNS", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "units", exact: true }).check();
  await page.getByRole("checkbox", { name: "price", exact: true }).check();
  await page.getByRole("button", { name: "Open auction", exact: true }).click();
  await expect(
    page.getByText("Persisted job · bidding", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("AUCTION_OPENED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit mission", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("Persisted job · bidding", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for the execution engine.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel unawarded auction" }).click();
  await expect(
    page.getByText("Persisted job · cancelled", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("JOB_CANCELLED", { exact: true })).toBeVisible();
  await expect(page.getByText("BID_SUBMITTED", { exact: true })).toHaveCount(0);
});

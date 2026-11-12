import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

test("real password auth, mission CRUD, session persistence, and two-user privacy", async ({
  browser,
}) => {
  // Disposable local accounts, not stored as test artifacts. No seeded auth bypass.
  const suffix = randomBytes(8).toString("hex");
  const password = randomBytes(24).toString("base64url");
  const aliceContext = await browser.newContext({ baseURL: "http://localhost:3000" });
  const bobContext = await browser.newContext({ baseURL: "http://localhost:3000" });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  async function authenticate(page: Page, email: string, signup: boolean) {
    await page.goto("/sign-in");
    if (signup)
      await page
        .getByRole("button", { name: "Need an account? Sign up" })
        .click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    if (signup) await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", {
        name: signup ? "Create account" : "Sign in",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  try {
    await alice.goto("/dashboard");
    await expect(alice).toHaveURL(/\/sign-in$/);
    await authenticate(alice, `alice-${suffix}@example.com`, true);
    await alice.getByRole("link", { name: "+ New mission" }).click();
    await alice.getByLabel("Mission title").fill(`Private sales ${suffix}`);
    await alice
      .getByRole("button", { name: "Use synthetic sample CSV" })
      .click();
    await alice.getByRole("checkbox", { name: "units", exact: true }).check();
    await alice.getByRole("button", { name: "Create private mission" }).click();
    await expect(alice).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
    await expect(
      alice.getByRole("heading", { name: `Private sales ${suffix}` }),
    ).toBeVisible();
    await expect(alice.getByTestId("saved-options")).toHaveText("units");
    const missionUrl = alice.url();
    await alice.reload();
    await expect(
      alice.getByRole("heading", { name: `Private sales ${suffix}` }),
    ).toBeVisible();
    await alice.getByRole("button", { name: "Edit mission" }).click();
    await alice.getByLabel("Mission title").fill(`Updated sales ${suffix}`);
    await alice.getByRole("checkbox", { name: "units", exact: true }).uncheck();
    await alice.getByRole("checkbox", { name: "price", exact: true }).check();
    await alice.getByRole("button", { name: "Save changes" }).click();
    await expect(
      alice.getByRole("heading", { name: `Updated sales ${suffix}` }),
    ).toBeVisible();
    await expect(alice.getByTestId("saved-options")).toHaveText("price");

    await authenticate(bob, `bob-${suffix}@example.com`, true);
    await expect(
      bob.getByText("Your first mission starts here."),
    ).toBeVisible();
    await bob.goto(missionUrl);
    await expect(
      bob.getByRole("heading", { name: "Workspace unavailable." }),
    ).toBeVisible();
    await expect(bob.getByText(`Updated sales ${suffix}`)).toHaveCount(0);

    await alice.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(alice).toHaveURL(/\/sign-in$/);
    await authenticate(alice, `alice-${suffix}@example.com`, false);
    await alice.goto(missionUrl);
    await expect(
      alice.getByRole("heading", { name: `Updated sales ${suffix}` }),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Delete draft", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Confirm delete", exact: true })
      .click();
    await expect(alice).toHaveURL(/\/dashboard$/);
    await expect(
      alice.getByText("Your first mission starts here."),
    ).toBeVisible();
  } finally {
    await Promise.allSettled([aliceContext.close(), bobContext.close()]);
  }
});

import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
test("application navigation, real filters, wallet setup state and mobile layout work", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button",{name:"Need an account? Sign up"}).click();
  await page.getByLabel("Email",{exact:true}).fill(`navigation-${randomBytes(8).toString("hex")}@example.com`);
  const password=randomBytes(24).toString("base64url");
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByLabel("Confirm password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading",{name:"Dashboard",exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Recent workspace metrics"})).toBeVisible();
  await expect(page.getByRole("region",{name:"Operator testnet wallet"})).toBeVisible();
  await page.getByRole("link",{name:"Payments",exact:true}).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole("heading",{name:"Payments",exact:true})).toBeVisible();
  await page.getByLabel("Payment status",{exact:true}).selectOption("FAILED");
  await expect(page.getByText("No payments prepared.",{exact:false})).toBeVisible();
  await page.getByRole("link",{name:"Agent directory",exact:true}).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole("link",{name:/Stats Core/})).toBeVisible();
  for (const width of [1440,768,390]) {
    await page.setViewportSize({width,height:900});
    await page.getByRole("link",{name:"Dashboard",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Dashboard",exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole("link",{name:"Missions",exact:true}).click();
    await expect(page).toHaveURL(/\/missions$/);
    await expect(page.getByLabel("Search saved missions",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

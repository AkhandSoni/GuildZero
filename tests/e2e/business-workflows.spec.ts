import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { acknowledgePreview } from "./helpers";

test("business templates persist options, reject ambiguous reconciliation and process private reports without unpaid result leakage", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({width:390,height:844});
  await page.goto("/sign-in");await page.getByRole("button",{name:"Need an account? Sign up"}).click();
  await page.getByLabel("Email",{exact:true}).fill(`business-${randomBytes(8).toString("hex")}@example.com`);
  const password=randomBytes(24).toString("base64url");
  await page.getByLabel("Password",{exact:true}).fill(password);await page.getByLabel("Confirm password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Create account",exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/);
  for (const [service,title,csv] of [
    ["csv_validate","Data quality audit","id,units\na,3\na,bad\nb,"],
    ["csv_reconcile","Keyed reconciliation","id,amount\na,10\nb,20"],
    ["csv_report","Grouped numeric report","region,units\nNorth,3\nSouth,5\nNorth,2"],
  ] as const) {
    await page.goto(`/missions/new?service=${service}`);
    await expect(page.getByLabel("Service template",{exact:true})).toHaveValue(service);
    await page.getByLabel("Mission title").fill(title);
    await page.getByLabel("Upload a CSV file",{exact:true}).setInputFiles({name:"business.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
    if(service==="csv_validate") {
      await page.getByRole("checkbox",{name:"id",exact:true}).check();
      await page.getByRole("checkbox",{name:"units",exact:true}).check();
      await page.getByRole("checkbox",{name:"Check units as numeric",exact:true}).check();
    } else if(service==="csv_reconcile") {
      await page.getByRole("checkbox",{name:"amount",exact:true}).check();
      await page.getByLabel("Upload comparison CSV",{exact:true}).setInputFiles({name:"other.csv",mimeType:"text/csv",buffer:Buffer.from("amount,id\n10,a\n25,a")});
      await page.getByLabel("Match rows by key",{exact:true}).selectOption("id");
    } else {
      await page.getByLabel("Group by column",{exact:true}).selectOption("region");
      await page.getByRole("button",{name:"Select numeric columns",exact:true}).click();
    }
    await page.getByRole("button",{name:"Create private mission",exact:true}).click();
    await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
    if(service==="csv_reconcile") {
      await expect(page.getByRole("alert").filter({hasText:"Correct report input before opening"})).toContainText("unique");
      await expect(page.getByRole("button",{name:"Open auction",exact:true})).toBeDisabled();
      await page.getByRole("button",{name:"Edit mission",exact:true}).click();
      await expect(page.getByLabel("Comparison CSV",{exact:true})).toHaveValue("amount,id\n10,a\n25,a");
      await page.getByLabel("Comparison CSV",{exact:true}).fill("amount,id\n10,a\n25,b\n40,c");
      await page.getByRole("button",{name:"Save changes",exact:true}).click();
      await expect(page.getByRole("button",{name:"Save changes",exact:true})).toHaveCount(0);
      await expect(page.getByRole("button",{name:"Edit mission",exact:true})).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
    await acknowledgePreview(page);await page.getByRole("button",{name:"Open auction",exact:true}).click();
    await expect(page.getByText(`${title} · Work accepted`,{exact:true})).toBeVisible({timeout:25000});
    await expect(page.getByRole("region",{name:"Locked deliverable preview",exact:true})).toBeVisible();
    await expect(page.getByRole("region",{name:"Business report result",exact:true})).toHaveCount(0);
    await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole("link",{name:"Missions",exact:true}).click();
    await page.getByLabel("Filter by service",{exact:true}).selectOption(service);
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
  }
  await page.goto("/missions/new?service=csv_reconcile");
  await page.getByLabel("Mission title").fill("Synthetic reconciliation starter");
  await page.getByRole("button",{name:"Use synthetic sample CSV",exact:true}).click();
  await page.getByRole("button",{name:"Use synthetic comparison CSV",exact:true}).click();
  await page.getByLabel("Match rows by key",{exact:true}).selectOption("order_id");
  await page.getByRole("checkbox",{name:"amount",exact:true}).check();
  await page.getByRole("checkbox",{name:"status",exact:true}).check();
  await page.getByRole("button",{name:"Create private mission",exact:true}).click();
  await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
  await acknowledgePreview(page);await page.getByRole("button",{name:"Open auction",exact:true}).click();
  await expect(page.getByText("Keyed reconciliation · Work accepted",{exact:true})).toBeVisible({timeout:25000});
  expect(errors).toEqual([]);
});

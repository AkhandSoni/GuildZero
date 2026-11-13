import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("upload, inspect, process, export, reuse and find a private mission", async ({ page }) => {
  test.setTimeout(90000);
  const suffix=randomBytes(6).toString("hex");
  await page.setViewportSize({width:390,height:844});
  await page.goto("/sign-in");
  await page.getByRole("button",{name:"Need an account? Sign up"}).click();
  await page.getByLabel("Email",{exact:true}).fill(`workflow-${suffix}@example.com`);
  const password=randomBytes(24).toString("base64url");
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByLabel("Confirm password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link",{name:"+ New mission",exact:true}).click();
  await expect(page).toHaveURL(/\/missions\/new$/);
  const title=`Imported sales ${suffix}`;
  const csv="product,units,price\nBag,3,2\nBook,5,4\nPen,,1";
  await page.getByLabel("Mission title").fill(title);
  await page.getByLabel("Maximum budget (testnet NEAR)").fill("6.2345");
  await page.getByLabel("Upload a CSV file",{exact:true}).setInputFiles({name:"sales.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
  await expect(page.getByLabel("CSV dataset",{exact:true})).toHaveValue(csv);
  await expect(page.getByLabel("Mission title")).toHaveValue(title);
  await expect(page.getByLabel("Maximum budget (testnet NEAR)")).toHaveValue("6.2345");
  await expect(page.getByRole("status").filter({hasText:"Loaded sales.csv"})).toBeVisible();
  await expect(page.getByRole("region",{name:"Dataset preview",exact:true})).toBeVisible();
  await expect(page.getByText("3 data rows · 3 columns",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Select numeric columns",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"units",exact:true})).toBeChecked();
  await expect(page.getByRole("checkbox",{name:"price",exact:true})).toBeChecked();
  await expect(page.getByRole("checkbox",{name:"product",exact:true})).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"Create private mission",exact:true}).click();
  await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
  const original=page.url();
  await page.reload();
  await expect(page.getByTestId("saved-options")).toHaveText("units, price");
  await expect(page.getByText("Review before starting:",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Open auction",exact:true}).click();
  await expect(page.getByText("Main analysis · Work accepted",{exact:true})).toBeVisible({timeout:30000});
  const summary=page.getByRole("region",{name:"Summary result",exact:true});
  await expect(summary.getByRole("row",{name:"units 2 1 3 5 8 4",exact:true})).toBeVisible();
  const download=page.waitForEvent("download");
  await page.getByRole("link",{name:"Download summary CSV",exact:true}).click();
  const stream=await(await download).createReadStream();const chunks=[];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain("units,2,1,3,5,8,4");
  await page.getByRole("button",{name:"Use as new mission",exact:true}).click();
  await expect(page).not.toHaveURL(original);
  const copyUrl = page.url();
  await expect(page.getByRole("heading",{name:`Copy of ${title}`,exact:true})).toBeVisible();
  await expect(page.getByText("Draft saved.",{exact:false})).toBeVisible();
  await expect(page.getByRole("button",{name:"Open auction",exact:true})).toBeVisible();
  await expect(page.getByText("Persisted job ·",{exact:false})).toHaveCount(0);
  await page.getByRole("link",{name:"Missions",exact:true}).click();
  await page.getByLabel("Search saved missions",{exact:true}).fill(suffix);
  await page.getByRole("button",{name:"Search missions",exact:true}).click();
  await page.getByLabel("Mission status",{exact:true}).selectOption("draft");
  await expect(page.getByRole("heading",{name:`Copy of ${title}`,exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:title,exact:true})).toHaveCount(0);
  await page.getByLabel("Mission status",{exact:true}).selectOption("active");
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
  await page.getByLabel("Filter by service",{exact:true}).selectOption("csv_normalize");
  await expect(page.getByText("No missions match these filters.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Show all missions",exact:true}).click();
  await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto(copyUrl);
  await page.getByRole("button",{name:"Edit mission",exact:true}).click();
  await page.getByRole("checkbox",{name:"Require human review of acceptance notes",exact:false}).check();
  await page.getByRole("button",{name:"Save changes",exact:true}).click();
  await page.getByRole("button",{name:"Open auction",exact:true}).click();
  await expect(page.getByText("Main analysis · Needs your review",{exact:true})).toBeVisible({timeout:30000});
  await page.getByRole("link",{name:"Dashboard",exact:true}).click();
  await expect(page.getByRole("link").filter({hasText:"Review work"})).toContainText("Copy of " + title);
});

test("import errors preserve valid data and selections, and clearing allows reimport", async ({ page }) => {
  await page.goto("/sign-in");await page.getByRole("button",{name:"Need an account? Sign up"}).click();
  await page.getByLabel("Email",{exact:true}).fill(`import-${randomBytes(8).toString("hex")}@example.com`);
  const password=randomBytes(24).toString("base64url");
  await page.getByLabel("Password",{exact:true}).fill(password);await page.getByLabel("Confirm password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Create account",exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/missions/new");
  const chooser=page.getByLabel("Upload a CSV file",{exact:true});
  await chooser.setInputFiles({name:"good.csv",mimeType:"text/csv",buffer:Buffer.from("units\n3")});
  await page.getByRole("button",{name:"Select numeric columns",exact:true}).click();
  for(const [name,buffer,message] of [
    ["wrong.xlsx",Buffer.from("units\n4"),"Choose a .csv file"],
    ["large.csv",Buffer.alloc(65537,65),"no larger than 64 KiB"],
    ["ragged.csv",Buffer.from("a,b\n1"),"column count"],
    ["bad-encoding.csv",Buffer.from([255,254,0,1]),"UTF-8"],
  ] as const) {
    await chooser.setInputFiles({name,mimeType:"text/csv",buffer});
    await expect(page.getByRole("alert").filter({hasText:message})).toBeVisible();
    await expect(page.getByLabel("CSV dataset",{exact:true})).toHaveValue("units\n3");
    await expect(page.getByRole("checkbox",{name:"units",exact:true})).toBeChecked();
  }
  await page.getByRole("button",{name:"Clear dataset",exact:true}).click();
  await expect(page.getByLabel("CSV dataset",{exact:true})).toHaveValue("");
  await expect(page.getByRole("checkbox",{name:"units",exact:true})).toHaveCount(0);
  await chooser.setInputFiles({name:"good.csv",mimeType:"text/csv",buffer:Buffer.from("units\n3")});
  await expect(page.getByLabel("CSV dataset",{exact:true})).toHaveValue("units\n3");
  await expect(page.locator("#csv-file-error")).toHaveCount(0);
});

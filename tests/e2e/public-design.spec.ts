import { expect, test } from "@playwright/test";
test("public service example computes real outputs, links reach the app, and all sections fit mobile", async ({page})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading",{level:1})).toContainText("Work you can verify.");
  const example=page.getByRole("region",{name:"Interactive service example"});
  await expect(example.getByRole("row",{name:"units 3 10",exact:true})).toBeVisible();
  await expect(example.getByRole("row",{name:"revenue 3 82.5",exact:true})).toBeVisible();
  await example.getByRole("button",{name:"Normalization",exact:true}).click();
  await expect(example.locator(".example-output pre")).toHaveText("product,units,revenue\ncanvas bag,3,37.50\nnotebook,5,20.00\ncanvas bag,2,25.00");
  await example.getByRole("button",{name:"Statistics",exact:true}).click();
  await expect(example.getByRole("row",{name:"revenue 3 82.5",exact:true})).toBeVisible();
  await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:"Services",exact:true}).click();
  await expect(page).toHaveURL(/#services$/);
  await expect(page.getByRole("heading",{name:"Column normalization",exact:true})).toBeVisible();
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByRole("link",{name:"Open your workspace",exact:true}).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel("Email",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

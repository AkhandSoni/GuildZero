import {randomBytes} from "node:crypto";
import {expect,test} from "@playwright/test";
import {acknowledgePreview} from "./helpers";
test("unpaid full content never arrives in the browser subscription and unfunded launch requires acknowledgment",async({page})=>{
 const delivered:Record<string,unknown>[]=[];
 page.on("websocket",socket=>socket.on("framereceived",frame=>{
  try{const payload=JSON.parse(String(frame.payload));for(const change of payload.modifications??[]){const value=change.value;if(value?.job&&Array.isArray(value.deliverables)&&value.deliverables.length)delivered.push(value);}}catch{/* Non-query protocol messages are not result evidence. */}
 }));
 await page.setViewportSize({width:390,height:844});await page.goto("/sign-in");await page.getByRole("button",{name:"Need an account? Sign up"}).click();await page.getByLabel("Email",{exact:true}).fill(`delivery-lock-${randomBytes(8).toString("hex")}@example.com`);const password=randomBytes(24).toString("base64url");await page.getByLabel("Password",{exact:true}).fill(password);await page.getByLabel("Confirm password",{exact:true}).fill(password);await page.getByRole("button",{name:"Create account",exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/);
 await page.goto("/missions/new");await page.getByLabel("Mission title").fill("Locked output subscription");await page.getByRole("button",{name:"Use synthetic sample CSV"}).click();await page.getByRole("button",{name:"Select numeric columns",exact:true}).click();await page.getByRole("button",{name:"Create private mission",exact:true}).click();await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
 await expect(page.getByRole("region",{name:"Payment readiness",exact:true})).not.toContainText("Checking settlement configuration…");
 const acknowledgment=page.getByRole("checkbox",{name:/I understand only a metadata preview/});
 if(await acknowledgment.count())await expect(page.getByRole("button",{name:"Open auction",exact:true})).toBeDisabled();
 await acknowledgePreview(page);await page.getByRole("button",{name:"Open auction",exact:true}).click();await expect(page.getByText("Main analysis · Work accepted",{exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByRole("region",{name:"Locked deliverable preview",exact:true})).toContainText("metadata only");await expect(page.getByRole("region",{name:"Summary result",exact:true})).toHaveCount(0);await expect(page.getByRole("link",{name:/Download/})).toHaveCount(0);await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
 expect(delivered.length).toBeGreaterThan(0);
 for(const response of delivered){for(const result of response.deliverables as Record<string,unknown>[]){expect(result.content).toBeNull();expect(result).not.toHaveProperty("verificationPayload");expect(result.preview).toBeDefined();}}
 await page.reload();await expect(page.getByRole("region",{name:"Locked deliverable preview",exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const original=page.url();await page.getByRole("button",{name:"Use as new mission",exact:true}).click();await expect(page).not.toHaveURL(original);
 const newPreflight=page.getByRole("region",{name:"Payment readiness",exact:true});await expect(newPreflight).toBeVisible();await expect(newPreflight).not.toContainText("Checking settlement configuration…");
 const newAcknowledgment=page.getByRole("checkbox",{name:/I understand only a metadata preview/});
 if(await newAcknowledgment.count()){await expect(newAcknowledgment).not.toBeChecked();await expect(page.getByRole("button",{name:"Open auction",exact:true})).toBeDisabled();}
});

import { expect, type Page } from "@playwright/test";
export async function acknowledgePreview(page: Page) {
  const preflight=page.getByRole("region",{name:"Payment readiness",exact:true});
  await expect(preflight).toBeVisible();
  await expect(preflight).not.toContainText("Checking settlement configuration…");
  const acknowledgment=page.getByRole("checkbox",{name:/I understand only a metadata preview/});
  if(await acknowledgment.count())await acknowledgment.check();
}

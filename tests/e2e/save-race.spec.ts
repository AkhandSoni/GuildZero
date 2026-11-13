import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("pending save freezes the submitted brief until persistence completes", async ({ page }) => {
  let release: (() => void) | undefined;
  let observed = false;
  await page.routeWebSocket(/\/api\/.*sync/, socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => {
      const frame = JSON.parse(String(message));
      if (frame.type === "Mutation" && frame.udfPath === "missions:create") {
        observed = true;
        release = () => server.send(message);
      } else server.send(message);
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Need an account? Sign up" }).click();
  await page.getByLabel("Email", { exact: true }).fill(`save-${randomBytes(8).toString("hex")}@example.com`);
  const password = randomBytes(24).toString("base64url");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/missions/new");
  await page.getByLabel("Mission title").fill("Persist exactly this brief");
  await page.getByLabel("CSV dataset", { exact: true }).fill("units\n3");
  await page.getByRole("checkbox", { name: "units", exact: true }).check();
  await page.getByRole("button", { name: "Create private mission", exact: true }).click();
  await expect.poll(() => observed).toBe(true);
  try {
    await expect(page.getByLabel("Mission title")).toBeDisabled();
    await expect(page.getByLabel("CSV dataset", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Service template", { exact: true })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "units", exact: true })).toBeDisabled();
  } finally { release?.(); }
  await expect(page).toHaveURL(/\/missions\/(?!new$)[a-z0-9]+$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Persist exactly this brief", exact: true })).toBeVisible();
});

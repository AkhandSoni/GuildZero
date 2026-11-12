import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
it.each(["1234567", "x".repeat(129)])("rejects out-of-policy signup passwords on the backend before account creation", async (password) => {
  const t = convexTest(schema, modules);
  await expect(t.action(api.auth.signIn, { provider: "password", params: {
    flow: "signUp", email: "invalid-policy@example.com", password,
  } })).rejects.toThrow("Password must contain 8–128 characters.");
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toEqual([]);
});

import { testBackend } from "../helpers/backend";
import { expect, it } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
it.each(["123456789", "x".repeat(101)])("rejects out-of-policy signup passwords on the backend before account creation", async (password) => {
  const t = testBackend(schema, modules);
  await expect(t.mutation(api.auth.signIn, {
    flow: "signUp", email: "invalid-policy@example.com", password,
  })).resolves.toMatchObject({ status: "error" });
  expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
});

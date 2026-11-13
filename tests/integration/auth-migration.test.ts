import { scryptSync } from "node:crypto";
import { expect, it } from "vitest";
import { sessionIdentity } from "@convex-dev/auth/test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { testBackend, asUser } from "../helpers/backend";
const modules = import.meta.glob("../../convex/**/*.ts");
async function legacy(password = "gZ!8_Ab?") {
  const t = testBackend(schema, modules);
  const email = "legacy-migration@example.com";
  const salt = "0123456789abcdef0123456789abcdef";
  const secret = `${salt}:${scryptSync(password.normalize("NFKC"), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email });
    await ctx.db.insert("authAccounts", { userId: id, provider: "password", providerAccountId: email, secret });
    return id;
  });
  return { t, email, password, userId };
}
it("migrates an existing eight-character credential without changing its owner or private missions", async () => {
  const s = await legacy();
  const before = await asUser(s.t, s.userId);
  const missionId = await before.mutation(api.missions.create, { title: "Existing private mission", serviceType: "csv_summary", inputCsv: "units\n3", options: { columns: ["units"] }, maxBudgetYocto: "1000000000000000000000000", deadlineAt: Date.now() + 86400000, acceptanceCriteria: "Template", requiresHumanReview: false });
  const signed = await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email.toUpperCase(), password: s.password });
  expect(signed.status).toBe("complete");
  if (signed.status !== "complete") throw new Error("Migration failed");
  expect(signed.tokens.userId).toBe(s.userId);
  const after = s.t.withIdentity(sessionIdentity(signed.tokens));
  expect((await after.query(api.missions.get, { id: missionId })).ownerId).toBe(s.userId);
  expect((await s.t.run((ctx) => ctx.db.get(s.userId)))?.authVersion).toBe(2);
  expect(await s.t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  await expect(s.t.withIdentity({ subject: `${s.userId}|obsolete-v1-session` }).query(api.missions.get, { id: missionId })).rejects.toThrow("UNAUTHENTICATED");
});
it("does not migrate or change another account on wrong credentials or duplicate signup", async () => {
  const s = await legacy();
  expect(await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: "incorrect-password", newPassword: "BrandNew!Passphrase42" })).toEqual({ status: "error", error: "INVALID_CREDENTIALS" });
  expect(await s.t.mutation(api.auth.signIn, { flow: "signUp", email: s.email, password: "BrandNew!Passphrase42" })).toEqual({ status: "error", error: "EMAIL_ALREADY_REGISTERED" });
  expect((await s.t.run((ctx) => ctx.db.get(s.userId)))?.authVersion).toBeUndefined();
});
it("preserves legacy NFKC equivalence after converting the credential", async () => {
  const s = await legacy("Ｍｉｇｒａｔｅ！８");
  for (const password of ["Migrate!8", "Ｍｉｇｒａｔｅ！８"]) {
    expect((await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password })).status).toBe("complete");
  }
});
it("requires old-password proof before upgrading a legacy password that Auth 2 rejects", async () => {
  const s = await legacy("password1234");
  expect(await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: s.password })).toEqual({ status: "error", error: "PASSWORD_UPGRADE_REQUIRED" });
  expect((await s.t.run((ctx) => ctx.db.get(s.userId)))?.authVersion).toBeUndefined();
  const signed = await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: s.password, newPassword: "Migrated!PrivatePassphrase42" });
  expect(signed.status).toBe("complete");
  expect((await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: "Migrated!PrivatePassphrase42" })).status).toBe("complete");
  expect((await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: s.password })).status).toBe("error");
});
it("rate-limits legacy attempts before a sixth expensive verification", async () => {
  const s = await legacy();
  for (let attempt = 0; attempt < 5; attempt++) expect((await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: "incorrect-password" })).status).toBe("error");
  expect(await s.t.mutation(api.auth.signIn, { flow: "signIn", email: s.email, password: s.password })).toEqual({ status: "error", error: "RATE_LIMITED" });
  expect((await s.t.run((ctx) => ctx.db.get(s.userId)))?.authVersion).toBeUndefined();
});
it("revokes a signed-in session even while its access token has not expired", async () => {
  const t = testBackend(schema, modules);
  const signed = await t.mutation(api.auth.signIn, { flow: "signUp", email: "revoked@example.com", password: "Private!SessionPassphrase42" });
  if (signed.status !== "complete") throw new Error("Signup failed");
  const user = t.withIdentity(sessionIdentity(signed.tokens));
  expect(await user.query(api.auth.isAuthenticated, {})).toBe(true);
  await user.mutation(api.auth.signOut, { refreshToken: signed.tokens.refreshToken });
  expect(await user.query(api.auth.isAuthenticated, {})).toBe(false);
  await expect(user.query(api.marketViews.overview, {})).rejects.toThrow("UNAUTHENTICATED");
  await t.finishInProgressScheduledFunctions();
});
it("rejects common passwords and rolls back account creation", async () => {
  const t = testBackend(schema, modules);
  expect(await t.mutation(api.auth.signIn, { flow: "signUp", email: "common@example.com", password: "password1234" })).toEqual({ status: "error", error: "PASSWORD_TOO_COMMON" });
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
});

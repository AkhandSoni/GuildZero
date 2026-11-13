import { setupConvexAuth } from "@convex-dev/auth/server";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { verifyPassword as verifyScrypt } from "password-hash-wasm/scrypt";
import { encodePHC } from "password-hash-wasm/scrypt-encode";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { MAX_PASSWORD_LENGTH } from "../lib/auth-policy";
// Unverified-email demo semantics are preserved without adding an email service.
// Auth 2 owns all sessions and all new/converted password hashes. This method
// only maps the app's existing email/user IDs and verifies legacy credentials.
const core = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = core;
const limiter = new RateLimiter(components.legacyAuthLimiter, {
  legacyPassword: { kind: "token bucket", rate: 1, period: MINUTE, capacity: 5 },
});
const authArgs = { flow: v.union(v.literal("signIn"), v.literal("signUp")), email: v.string(), password: v.string(), newPassword: v.optional(v.string()) };
type AccountResult = { userId: Id<"users"> } | { error: string };
function normalizedEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError({ code: "AUTH_INPUT_REJECTED" });
  return email;
}
export const authenticateAccount = internalMutation({ args: authArgs, handler: async (ctx, args): Promise<AccountResult> => {
  const email = normalizedEmail(args.email);
  const old = await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email)).unique();
  const user = old ? await ctx.db.get(old.userId) : await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
  if (args.flow === "signUp") {
    if (user || old) return { error: "EMAIL_ALREADY_REGISTERED" };
    const userId = await ctx.db.insert("users", { email, authVersion: 2 });
    const set = await ctx.runMutation(components.authPassword.public._internal_dangerous_setPassword, { userId, password: args.password, minimumLength: 10 });
    if (!set.success) throw new ConvexError({ code: "AUTH_PASSWORD_REJECTED", reason: set.userError.error });
    return { userId };
  }
  if (!user) return { error: "INVALID_CREDENTIALS" };
  if (user.authVersion === 2) {
    const verified = await ctx.runMutation(components.authPassword.public.verifyPassword, { userId: user._id, password: user.authPasswordNfkc ? args.password.normalize("NFKC") : args.password });
    return verified.success ? { userId: user._id } : { error: verified.userError.error };
  }
  if (!old?.secret || args.password.length < 8 || args.password.length > 128) return { error: "INVALID_CREDENTIALS" };
  const rate = await limiter.limit(ctx, "legacyPassword", { key: user._id });
  if (!rate.ok) return { error: "RATE_LIMITED" };
  // Exact Lucia Scrypt encoding: UTF-8 salt text, N=2^14, r=16, p=1.
  const match = /^([0-9a-f]{32}):([0-9a-f]{128})$/.exec(old.secret);
  if (!match) throw new Error("Legacy password encoding requires operator review.");
  const phc = await encodePHC({ ln: 14, r: 16, p: 1, salt: new TextEncoder().encode(match[1]), hash: Uint8Array.from(match[2].match(/../g)!, (byte) => parseInt(byte, 16)) });
  if (!(await verifyScrypt(args.password.normalize("NFKC"), phc))) return { error: "INVALID_CREDENTIALS" };
  const replacement = args.newPassword ?? args.password.normalize("NFKC");
  if (replacement.length > MAX_PASSWORD_LENGTH) return { error: "PASSWORD_UPGRADE_REQUIRED" };
  const set = await ctx.runMutation(components.authPassword.public._internal_dangerous_setPassword, { userId: user._id, password: replacement, minimumLength: args.newPassword ? 10 : 8 });
  if (!set.success) return { error: args.newPassword ? set.userError.error : "PASSWORD_UPGRADE_REQUIRED" };
  await ctx.db.patch(user._id, { authVersion: 2, authPasswordNfkc: args.newPassword ? undefined : true });
  return { userId: user._id };
} });
export const signIn = mutation({ args: authArgs, handler: async (ctx, args): Promise<{ status: "error"; error: string } | { status: "complete"; tokens: { accessToken: string; refreshToken: string; refreshTokenExpiresAt: number; userId: string } }> => {
  let result: AccountResult;
  try { result = await ctx.runMutation(internal.auth.authenticateAccount, args); }
  catch (error) {
    if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data && error.data.code === "AUTH_PASSWORD_REJECTED")
      return { status: "error" as const, error: String(error.data.reason) };
    throw error;
  }
  if ("error" in result) return { status: "error" as const, error: result.error };
  // Privileged component call stays behind the complete credential check above.
  // No public argument can supply userId, claims, or an approval bypass.
  const tokens = await ctx.runMutation(components.auth.public._internal_dangerous_signIn, {
    userId: result.userId, claims: { method: "guildzeroEmailPassword", profile: { email: normalizedEmail(args.email) } }, componentPath: "authPassword",
    accessTokenTtlSeconds: 60, refreshInactivityTimeoutSeconds: 30 * 86400, sessionMaxLifetimeSeconds: 30 * 86400,
  });
  return { status: "complete" as const, tokens };
} });

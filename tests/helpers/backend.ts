import { convexTest } from "convex-test";
import authCore, { sessionIdentity } from "@convex-dev/auth/test";
import authPassword from "@convex-dev/auth/components/password/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import type schema from "../../convex/schema";
import { components } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
export function testBackend(model: typeof schema, modules: Record<string, () => Promise<unknown>>) {
  const t = convexTest(model, modules);
  authCore.registerCore(t);
  authPassword.registerPassword(t);
  registerRateLimiter(t, "legacyAuthLimiter");
  return t;
}
export async function asUser(t: ReturnType<typeof testBackend>, userId: Id<"users">) {
  // Trusted test-owned session, matching Auth 2's session-based identity.
  const tokens = await t.mutation(components.auth.public._internal_dangerous_signIn, {
    userId, claims: { method: "guildzeroEmailPassword", profile: {} }, componentPath: "authPassword",
    accessTokenTtlSeconds: 60, refreshInactivityTimeoutSeconds: 86400, sessionMaxLifetimeSeconds: 86400,
  });
  return t.withIdentity(sessionIdentity(tokens));
}

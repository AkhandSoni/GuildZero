import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { validNewPassword } from "../lib/auth-policy";
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        if (
          typeof params.email !== "string" ||
          params.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email.trim())
        )
          throw new ConvexError("A valid email address is required.");
        return { email: params.email.trim().toLowerCase() };
      },
      validatePasswordRequirements(password) {
        if (!validNewPassword(password))
          throw new ConvexError("Password must contain 8–128 characters.");
      },
    }),
  ],
});

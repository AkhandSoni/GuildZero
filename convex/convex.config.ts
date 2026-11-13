import { defineApp } from "convex/server";
import auth from "@convex-dev/auth/convex.config.js";
import passwords from "@convex-dev/auth/components/password/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
const app = defineApp();
app.use(auth);
app.use(passwords, { name: "authPassword" });
app.use(rateLimiter, { name: "legacyAuthLimiter" });
export default app;

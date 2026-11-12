import { afterEach, expect, it, vi } from "vitest";
import { convexLogger } from "../lib/convex-logger";
afterEach(() => vi.restoreAllMocks());
it.each(["InvalidAccountId", "InvalidSecret", "TooManyFailedAttempts"])("keeps expected %s rejection out of the development error overlay", (code) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  convexLogger.error(`[CONVEX A(auth:signIn)] [Request ID: 03483a8329ac6874] Server Error\nUncaught Error: ${code}\n    at retrieveAccount`);
  expect(error).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledWith("Sign-in was not accepted. Check the message in the sign-in form.");
});
it.each([
  "[CONVEX A(auth:signIn)] [Request ID: abc123] Server Error\nUncaught Error: JWT_PRIVATE_KEY configuration unavailable",
  "[CONVEX M(missions:create)] [Request ID: abc123] Server Error\nUncaught Error: InvalidAccountId",
  "[CONVEX FATAL ERROR] Unable to connect",
  "Unexpected application failure",
])("preserves unexpected errors and other function failures", (message) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  convexLogger.error(message);
  expect(error).toHaveBeenCalledWith(message);
});

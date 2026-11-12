// Convex forwards dev-backend errors to console.error even when the caller
// catches them. Next's dev overlay treats those as application failures.
// Credential rejections belong in the sign-in form; keep all other errors.
export const convexLogger = {
  logVerbose() {},
  log(...args: unknown[]) { console.log(...args); },
  warn(...args: unknown[]) { console.warn(...args); },
  error(...args: unknown[]) {
    const message = args[0];
    if (args.length === 1 && typeof message === "string" &&
      /^\[CONVEX A\(auth:signIn\)\] \[Request ID: [a-z0-9]+\] Server Error\r?\nUncaught Error: (?:InvalidAccountId|InvalidSecret|TooManyFailedAttempts)(?:\r?\n|$)/.test(message)) {
      console.warn("Sign-in was not accepted. Check the message in the sign-in form.");
      return;
    }
    console.error(...args);
  },
};

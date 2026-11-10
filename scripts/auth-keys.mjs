import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

// Same RS256/PKCS8/JWKS layout as Convex Auth's official setup helper.
// Secrets exist only in memory and the selected backend's environment.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .trimEnd()
  .replace(/\n/g, " ");
const jwks = JSON.stringify({
  keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }],
});
const variables = `JWT_PRIVATE_KEY=${pem}\nJWKS=${jwks}\n`;
const result = spawnSync(
  process.execPath,
  ["node_modules/convex/bin/main.js", "env", "set"],
  {
    input: variables,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  },
);
if (result.status !== 0) {
  console.error(
    "Auth key setup failed. Ensure Convex is running and configured. Existing keys are never overwritten; use the Convex dashboard to inspect configuration. No key values were printed.",
  );
  process.exit(1);
}
console.log(
  "RS256 auth keys configured on the selected backend. No secrets were written to source files or printed.",
);

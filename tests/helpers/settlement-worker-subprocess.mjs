import module from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getFunctionName } from "convex/server";
import { KeyPairSigner } from "near-api-js";

const pending = new Map();
let nextId = 1;

process.on("message", (msg) => {
  if (!msg || typeof msg !== "object" || typeof msg.id !== "number") return;
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.ok) entry.resolve(msg.value);
  else entry.reject(new Error(msg.error || "IPC_ERROR"));
});

function callParent(payload) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    process.send({ id, ...payload }, (error) => {
      if (error) { pending.delete(id); rejectPromise(new Error("IPC_DISCONNECTED")); }
    });
  });
}

process.on("disconnect", () => {
  for (const entry of pending.values()) entry.reject(new Error("IPC_DISCONNECTED"));
  pending.clear();
});

// Observe the actual SDK call in this child process, including rejected claims.
// Only finite event names cross IPC: no transaction, signature or key material.
const signTransaction = KeyPairSigner.prototype.signTransaction;
KeyPairSigner.prototype.signTransaction = async function (...args) {
  await callParent({ type: "signing_attempt" });
  const result = await signTransaction.apply(this, args);
  await callParent({ type: "signing_complete" });
  return result;
};

globalThis.__guildzeroIpcRpc = {
  assertTestnet: () => callParent({ type: "rpc_assert_testnet" }),
  rpc: (method, params) => callParent({ type: "rpc_call", method, params }),
};

const rpcOverrideUrl =
  "data:text/javascript," +
  encodeURIComponent(
    "export const TESTNET_RPC = 'https://rpc.testnet.near.org';\n" +
      "export const assertTestnet = (...a) => globalThis.__guildzeroIpcRpc.assertTestnet(...a);\n" +
      "export const rpc = (...a) => globalThis.__guildzeroIpcRpc.rpc(...a);\n",
  );

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      context.parentURL?.startsWith("file:") &&
      !context.parentURL.includes("/node_modules/")
    ) {
      const base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
      if (
        base.endsWith("/lib/settlement/rpc") ||
        base.endsWith("/lib/settlement/rpc.ts")
      ) {
        return { url: rpcOverrideUrl, shortCircuit: true };
      }
      for (const candidate of [
        `${base}.ts`,
        `${base}.js`,
        resolve(base, "index.ts"),
        resolve(base, "index.js"),
      ]) {
        if (existsSync(candidate))
          return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { settle, reconcile } = await import("../../convex/nearSettlement.ts");
const ctx = {
  runMutation: (fn, args) =>
    callParent({
      type: "convex",
      kind: "mutation",
      name: getFunctionName(fn),
      args,
    }),
  runQuery: (fn, args) =>
    callParent({
      type: "convex",
      kind: "query",
      name: getFunctionName(fn),
      args,
    }),
};

const action = process.env.WORKER_ACTION || "settle";
const intentId = process.env.WORKER_INTENT_ID;
const fn = action === "reconcile" ? reconcile : settle;
const result = await fn._handler(ctx, { intentId });
await callParent({ type: "done", result });
process.exit(0);

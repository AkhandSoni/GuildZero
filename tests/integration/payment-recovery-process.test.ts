// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { KeyPair, decodeSignedTransaction, baseEncode } from "near-api-js";
import { makeFunctionReference } from "convex/server";
import { runWorkerProcess, stopWorkerProcesses } from "../helpers/worker-process";
import { testBackend, asUser } from "../helpers/backend";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
const modules = import.meta.glob("../../convex/**/*.ts");
const script = fileURLToPath(new URL("../helpers/settlement-worker-subprocess.mjs", import.meta.url));
afterEach(async () => { await stopWorkerProcesses(); vi.unstubAllEnvs(); });
async function setup() {
  const key = KeyPair.fromRandom("ed25519");
  const env = { NEAR_NETWORK: "testnet", NEAR_OPERATOR_ACCOUNT_ID: "operator.testnet", NEAR_PRIVATE_KEY: key.toString(), NEAR_SETTLEMENT_ENABLED: "true",
    NEAR_PAYMENT_RETRY_ENABLED: "true", NEAR_DEMO_ALLOWANCES_REQUIRED: "false", NEAR_AGENT_RECIPIENTS_JSON: JSON.stringify({ "stats-core": "worker.testnet" }) };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const t = testBackend(schema, modules);
  // Explicit policy fixture; the real service workflow is covered in the other
  // recovery integration file. This database and chain are offline test state.
  const ids = await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { email: "recovery-process@example.com" });
    const missionId = await ctx.db.insert("missions", { ownerId, title: "Offline recovery crash policy fixture", serviceType: "csv_summary", inputCsv: "x\n1", maxBudgetYocto: "1000000000000000000000000", acceptanceCriteria: "Fixture", deadlineAt: Date.now() + 86400000, state: "active", createdAt: Date.now(), updatedAt: Date.now() });
    const jobId = await ctx.db.insert("jobs", { ownerId, missionId, depth: 0, serviceType: "csv_summary", inputCsv: "x\n1", options: { columns: ["x"] }, budgetYocto: "1000000000000000000000000", reservedYocto: "200000000000000000000000", state: "approved", revisionCount: 0, createdAt: Date.now(), updatedAt: Date.now() });
    const bidId = await ctx.db.insert("bids", { jobId, agentId: "stats-core", priceYocto: "200000000000000000000000", minimumYocto: "100000000000000000000000", etaMs: 1, rationale: "Fixture", createdAt: Date.now() });
    await ctx.db.insert("contracts", { jobId, agentId: "stats-core", bidId, amountYocto: "200000000000000000000000", holdbackYocto: "200000000000000000000000", state: "completed", selectionReason: "Fixture", createdAt: Date.now() });
    const deliverableId = await ctx.db.insert("deliverables", { jobId, attempt: 1, format: "json", content: "{}", createdAt: Date.now() });
    await ctx.db.insert("verifications", { jobId, deliverableId, verdict: "pass", checks: [], createdAt: Date.now() });
    return { ownerId, jobId };
  });
  const owner = await asUser(t, ids.ownerId); const p = await owner.mutation(api.payments.prepare, { jobId: ids.jobId }); if (!p.ok) throw Error(p.code);
  const intent = (await owner.query(api.payments.forJob, { jobId: ids.jobId }))!;
  const authorize = async (attemptId = intent.currentAttemptId!) => {
    // Explicit authorization fixture avoids starting a real in-process Node
    // action alongside the test-owned child. Public authorization checks are
    // exercised separately in payment-recovery.test.ts.
    await t.run(async ctx => { const now = Date.now(); await ctx.db.patch(intent._id, { authorizedAt: now }); await ctx.db.patch(attemptId, { authorizedAt: now }); });
  };
  const chain = { nonce: 7n, broadcasts: 0, receipts: new Map<string, Record<string, unknown>>() };
  async function worker(attemptId: Id<"paymentAttempts">, mode: "none" | "preflight" | "lost-permit" | "identity" | "broadcast" | "deny-permit" = "none", action = "settle", failRead = false) {
    const counts = { initialized: 0, signing: 0, signed: 0 }; let done: unknown;
    const exit = await runWorkerProcess({ script, env: { ...process.env, ...env, WORKER_PROTOCOL: "recovery", WORKER_ATTEMPT_ID: attemptId, WORKER_ACTION: action },
      expectedSignal: ["preflight", "lost-permit", "identity", "broadcast"].includes(mode) ? "SIGKILL" : undefined,
      onMessage: async (raw, child) => {
        const msg = raw as { id: number; type: string; kind: "mutation" | "query"; name: string; args: Record<string, unknown>; method: string; params: Record<string, unknown>; result: unknown };
        const reply = (value: unknown) => { if (child.connected) child.send({ id: msg.id, ok: true, value }); };
        if (msg.type === "signer_initialization") { counts.initialized++; reply(null); return; }
        if (msg.type === "signing_attempt") { counts.signing++; reply(null); return; }
        if (msg.type === "signing_complete") { counts.signed++; reply(null); return; }
        if (msg.type === "done") { done = msg.result; reply(null); return; }
        if (msg.type === "rpc_assert_testnet") { reply(null); return; }
        if (msg.type === "convex") {
          if (!msg.name.startsWith("paymentRecoveryWorker:")) throw Error("UNEXPECTED_CALLBACK");
          if (msg.name.endsWith(":signingPermit") && mode === "deny-permit") { reply(false); return; }
          const value = msg.kind === "mutation" ? await t.mutation(makeFunctionReference<"mutation">(msg.name), msg.args) : await t.query(makeFunctionReference<"query">(msg.name), msg.args);
          if ((msg.name.endsWith(":signingPermit") && mode === "lost-permit") || (msg.name.endsWith(":prepared") && mode === "identity")) { child.kill("SIGKILL"); return; }
          reply(value); return;
        }
        if (msg.type !== "rpc_call") throw Error("UNEXPECTED_MESSAGE");
        const { method, params } = msg;
        if (method === "EXPERIMENTAL_protocol_config") { reply({ runtime_config: { storage_amount_per_byte: "1" } }); return; }
        if (method === "query" && params.request_type === "view_account") {
          if (mode === "preflight") { child.kill("SIGKILL"); return; }
          if (failRead) { child.send({ id: msg.id, ok: false, error: "RPC_UNAVAILABLE" }); return; }
          reply({ amount: "10000000000000000000000000", storage_usage: 1 }); return;
        }
        if (method === "query" && params.request_type === "view_access_key") { reply({ nonce: Number(chain.nonce), permission: "FullAccess" }); return; }
        if (method === "block") { reply({ header: { hash: "1".repeat(32) } }); return; }
        if (method === "send_tx") {
          const signed = decodeSignedTransaction(Buffer.from(String(params.signed_tx_base64), "base64"));
          const digest = createHash("sha256").update(signed.transaction.encode()).digest(), hash = baseEncode(digest);
          expect(key.verify(digest, signed.signature.data)).toBe(true); expect(signed.transaction.nonce).toBe(chain.nonce + 1n);
          chain.nonce = signed.transaction.nonce; chain.broadcasts++;
          const receipt = { final_execution_status: "FINAL", transaction: { hash, signer_id: signed.transaction.signerId, receiver_id: signed.transaction.receiverId,
            nonce: signed.transaction.nonce.toString(), actions: [{ Transfer: { deposit: String(signed.transaction.actions[0].transfer?.deposit) } }] },
            transaction_outcome: { block_hash: "3".repeat(32) }, status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }] };
          chain.receipts.set(hash, receipt);
          if (mode === "broadcast") { child.kill("SIGKILL"); return; } reply(receipt); return;
        }
        if (method === "tx") {
          const receipt = chain.receipts.get(String(params.tx_hash));
          if (!receipt) { child.send({ id: msg.id, ok: false, error: "RPC_RESULT_UNAVAILABLE" }); return; } reply(receipt); return;
        }
        throw Error("UNEXPECTED_RPC");
      },
    });
    return { ...exit, counts, done };
  }
  return { t, owner, ...ids, intent, authorize, worker, chain };
}
it("observes zero real SDK initialization/signing on pre-sign closure and one signature after separate replacement authorization", async () => {
  const s = await setup(); await s.authorize(); const id = s.intent.currentAttemptId!;
  const failed = await s.worker(id, "none", "settle", true); expect(failed.counts).toEqual({ initialized: 0, signing: 0, signed: 0 }); expect(s.chain.broadcasts).toBe(0);
  const r = await s.owner.mutation(api.paymentRecovery.prepareRetry, { intentId: s.intent._id, attemptId: id, generation: 1, recipient: s.intent.recipient, amountYocto: s.intent.amountYocto, requestId: "real-sdk-retry-request" }); if (!r.ok) throw Error(r.code);
  expect((await s.worker(r.attemptId)).counts.signing).toBe(0);
  await s.authorize(r.attemptId); const success = await s.worker(r.attemptId); expect(success.counts).toEqual({ initialized: 1, signing: 1, signed: 1 }); expect(s.chain.broadcasts).toBe(1);
  expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!.status).toBe("CONFIRMED");
  expect((await s.worker(id)).counts.signing).toBe(0); expect((await s.worker(r.attemptId)).counts.signing).toBe(0); expect(s.chain.broadcasts).toBe(1);
});
it.each(["preflight", "lost-permit", "identity", "broadcast"] as const)("SIGKILL at %s never manufactures recovery proof or duplicate signing", async mode => {
  const s = await setup(); await s.authorize(); const id = s.intent.currentAttemptId!;
  const killed = await s.worker(id, mode); expect(killed.signal).toBe("SIGKILL");
  expect(killed.counts.signing).toBe(mode === "identity" || mode === "broadcast" ? 1 : 0);
  const before = (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!;
  expect(before.recovery?.eligible).toBe(false); expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toHaveLength(1);
  const duplicate = await s.worker(id); expect(duplicate.counts).toEqual({ initialized: 0, signing: 0, signed: 0 });
  expect(s.chain.broadcasts).toBe(mode === "broadcast" ? 1 : 0);
  if (mode === "broadcast") { const check = await s.worker(id, "none", "reconcile"); expect(check.counts.signing).toBe(0); expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!.status).toBe("CONFIRMED"); expect(s.chain.broadcasts).toBe(1); }
});
it("does not initialize a real signer when the atomic signing permit is denied", async () => {
  const s = await setup(); await s.authorize(); const result = await s.worker(s.intent.currentAttemptId!, "deny-permit");
  expect(result.counts).toEqual({ initialized: 0, signing: 0, signed: 0 }); expect(s.chain.broadcasts).toBe(0);
});

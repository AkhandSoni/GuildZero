// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { KeyPair, decodeSignedTransaction, baseEncode } from "near-api-js";
import { makeFunctionReference } from "convex/server";
import { runWorkerProcess, stopWorkerProcesses } from "../helpers/worker-process";
import { testBackend, asUser } from "../helpers/backend";
import { masterFixture } from "../helpers/master-fixtures";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
const modules = import.meta.glob("../../convex/**/*.ts");
const script = fileURLToPath(new URL("../helpers/settlement-worker-subprocess.mjs", import.meta.url));
afterEach(async () => { await stopWorkerProcesses(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  vi.useFakeTimers(); vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "false"); vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "false");
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "false"); vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  const t = testBackend(schema, modules);
  const ownerId = await t.run(ctx => ctx.db.insert("users", { email: "master-sdk-fixture@example.com" }));
  const owner = await asUser(t, ownerId), { context, plan } = masterFixture();
  const runId = await owner.mutation(api.masterAgent.create, { requestId: "master-sdk-process-fixture", prompt: context.prompt, datasets: context.datasets,
    capYocto: context.capYocto, deadlineAt: context.deadlineAt, requiresHumanReview: false });
  const claim = await owner.mutation(api.masterAgent.beginPlanning, { runId, revision: 1 });
  await owner.mutation(api.masterAgent.finishPlanning, { runId, revision: 1, token: claim.token, planJson: JSON.stringify(plan) });
  const view = await owner.query(api.masterAgent.get, { runId });
  await owner.mutation(api.masterAgent.accept, { runId, planHash: view.run.planHash!, allowUnfundedPreview: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const jobId = (await owner.query(api.masterAgent.get, { runId })).steps[0].jobId!;
  const key = KeyPair.fromRandom("ed25519");
  const env = { MASTER_AGENT_AUTOPAY_ENABLED: "true", NEAR_NETWORK: "testnet", NEAR_OPERATOR_ACCOUNT_ID: "operator.testnet", NEAR_PRIVATE_KEY: key.toString(),
    NEAR_SETTLEMENT_ENABLED: "true", NEAR_PAYMENT_RETRY_ENABLED: "false", NEAR_DEMO_ALLOWANCES_REQUIRED: "false",
    NEAR_AGENT_RECIPIENTS_JSON: JSON.stringify(Object.fromEntries(PUBLIC_AGENTS.filter(a => a.capabilities.length).map(a => [a.id, "worker.testnet"]))) };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const review = (await owner.query(api.masterAgent.spendingReview, { runId }))!;
  const grantId = await owner.mutation(api.masterAgent.authorizeSpending, { runId, planHash: review.planHash, policyHash: review.policyHash,
    capYocto: review.capYocto, expiresAt: review.expiresAt, purpose: "human_mission_spending" });
  await t.mutation(internal.masterAgentWorker.authorize, { grantId, jobId });
  const intent = (await owner.query(api.payments.forJob, { jobId }))!;
  const counts = { initialized: 0, signing: 0, signed: 0, broadcasts: 0 };
  async function worker(mode: "success" | "revoke-preflight" | "lost-permit") {
    let revoked = false;
    await runWorkerProcess({ script, env: { ...process.env, ...env, WORKER_PROTOCOL: "legacy", WORKER_OBSERVE_INITIALIZATION: "true", WORKER_INTENT_ID: intent._id },
      expectedSignal: mode === "lost-permit" ? "SIGKILL" : undefined,
      onMessage: async (raw, child) => {
        const msg = raw as { id: number; type: string; kind: "mutation" | "query"; name: string; args: Record<string, unknown>; method: string; params: Record<string, unknown> };
        const reply = (value: unknown) => { if (child.connected) child.send({ id: msg.id, ok: true, value }); };
        if (msg.type === "signer_initialization") { counts.initialized++; reply(null); return; }
        if (msg.type === "signing_attempt") { counts.signing++; reply(null); return; }
        if (msg.type === "signing_complete") { counts.signed++; reply(null); return; }
        if (msg.type === "done" || msg.type === "rpc_assert_testnet") { reply(null); return; }
        if (msg.type === "convex") {
          if (!msg.name.startsWith("paymentWorker:")) throw Error("UNEXPECTED_CALLBACK");
          const result = msg.kind === "mutation" ? await t.mutation(makeFunctionReference<"mutation">(msg.name), msg.args) : await t.query(makeFunctionReference<"query">(msg.name), msg.args);
          if (mode === "lost-permit" && msg.name.endsWith(":masterSigningPermit")) { child.kill("SIGKILL"); return; }
          reply(result); return;
        }
        if (msg.type !== "rpc_call") throw Error("UNEXPECTED_MESSAGE");
        if (msg.method === "query" && msg.params.request_type === "view_account") {
          if (mode === "revoke-preflight" && !revoked) { await owner.mutation(api.masterAgent.revokeSpending, { runId }); revoked = true; }
          reply({ amount: "10000000000000000000000000", storage_usage: 1 }); return;
        }
        if (msg.method === "EXPERIMENTAL_protocol_config") { reply({ runtime_config: { storage_amount_per_byte: "1" } }); return; }
        if (msg.method === "query" && msg.params.request_type === "view_access_key") { reply({ nonce: 7, permission: "FullAccess" }); return; }
        if (msg.method === "block") { reply({ header: { hash: "1".repeat(32) } }); return; }
        if (msg.method === "send_tx") {
          const signed = decodeSignedTransaction(Buffer.from(String(msg.params.signed_tx_base64), "base64"));
          const digest = createHash("sha256").update(signed.transaction.encode()).digest();
          expect(key.verify(digest, signed.signature.data)).toBe(true);
          expect(signed.transaction.receiverId).toBe(intent.recipient);
          expect(String(signed.transaction.actions[0].transfer?.deposit)).toBe(intent.amountYocto);
          counts.broadcasts++;
          reply({ final_execution_status: "FINAL", transaction: { hash: baseEncode(digest), signer_id: intent.sender, receiver_id: intent.recipient,
            nonce: signed.transaction.nonce.toString(), actions: [{ Transfer: { deposit: intent.amountYocto } }] },
            transaction_outcome: { block_hash: "3".repeat(32) }, status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }] }); return;
        }
        throw Error("UNEXPECTED_RPC");
      },
    });
  }
  return { t, owner, runId, jobId, intent, counts, worker };
}

it("runs the actual SDK after a valid human grant, confirms an offline receipt and releases computed output exactly once", async () => {
  const s = await setup(); await s.worker("success");
  expect(s.counts).toEqual({ initialized: 1, signing: 1, signed: 1, broadcasts: 1 });
  expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!.status).toBe("CONFIRMED");
  const detail = await s.owner.query(api.jobs.detail, { id: s.jobId }); expect(detail.delivery.released).toBe(true); expect(detail.deliverables[0].content).not.toBeNull();
  await s.worker("success"); expect(s.counts.broadcasts).toBe(1);
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toHaveLength(0);
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await s.owner.query(api.masterAgent.get, { runId: s.runId })).run.state).toBe("completed");
});
it("observes zero actual SDK initialization/signatures/broadcasts when the human revokes during preflight", async () => {
  const s = await setup(); await s.worker("revoke-preflight");
  expect(s.counts).toEqual({ initialized: 0, signing: 0, signed: 0, broadcasts: 0 });
  const intent = (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!;
  expect(intent.status).toBe("FAILED"); expect(intent.lastReason).toContain("MASTER_SIGNING_NOT_PERMITTED");
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(false);
});
it("retains admitted signing and the lock after lost permit acknowledgment without rearming or initializing a key", async () => {
  const s = await setup(); await s.worker("lost-permit");
  expect(s.counts).toEqual({ initialized: 0, signing: 0, signed: 0, broadcasts: 0 });
  expect((await s.t.run(ctx => ctx.db.get(s.intent._id)))!.masterSigningAdmittedAt).toBeDefined();
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toHaveLength(1);
  await s.worker("success"); expect(s.counts.broadcasts).toBe(0);
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(false);
});

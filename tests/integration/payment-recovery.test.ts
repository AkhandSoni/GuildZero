import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import * as recoveryHelpers from "../../convex/paymentRecoveryHelpers";
import type { Id } from "../../convex/_generated/dataModel";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
const modules = import.meta.glob("../../convex/**/*.ts");
// Offline RPC/SDK fixtures. These tests make no real signature or transfer.
const transport = vi.hoisted(() => ({ rpc: vi.fn(), assertTestnet: vi.fn(), signerInit: vi.fn(), sign: vi.fn(), create: vi.fn() }));
vi.mock("../../lib/settlement/rpc", () => ({ rpc: transport.rpc, assertTestnet: transport.assertTestnet, TESTNET_RPC: "https://rpc.testnet.near.org" }));
vi.mock("near-api-js", () => ({
  Account: class { async createTransaction() { transport.create(); return { nonce: 7n }; } },
  JsonRpcProvider: class {}, KeyPairSigner: { fromSecretKey: () => { transport.signerInit(); return { getPublicKey: async () => ({}), signTransaction: async () => {
    transport.sign(); return { txHash: new Uint8Array(32), signedTransaction: { encode: () => new Uint8Array([1]) } };
  } }; } }, actions: { transfer: (amount: bigint) => ({ amount }) }, baseEncode: () => "1".repeat(32),
}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
async function setup(clean = false) {
  vi.useFakeTimers(); vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "true"); vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "false");
  vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  const t = testBackend(schema, modules);
  const [ownerId, otherId] = await t.run(ctx => Promise.all([ctx.db.insert("users", { email: "retry@example.com" }), ctx.db.insert("users", { email: "outsider@example.com" })]));
  const owner = await asUser(t, ownerId), other = await asUser(t, otherId);
  const missionId = await owner.mutation(api.missions.create, { title: "Actual synthetic service for offline recovery policy tests", serviceType: "csv_summary",
    inputCsv: "units\n 3 \n5", options: { columns: ["units"] }, requiresHumanReview: false, cleanBeforeProcessing: clean,
    acceptanceCriteria: "Computed template checks", maxBudgetYocto: "1000000000000000000000000", deadlineAt: Date.now() + 86400000 });
  const jobId = await owner.mutation(api.jobs.start, { missionId, allowUnfundedPreview: true });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await owner.query(api.jobs.detail, { id: jobId })).job.state).toBe("approved");
  vi.stubEnv("NEAR_NETWORK", "testnet"); vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true"); vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet");
  vi.stubEnv("NEAR_PRIVATE_KEY", "offline-fixture-only");
  vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify(Object.fromEntries(PUBLIC_AGENTS.filter(a => a.capabilities.length).map(a => [a.id, a.id + ".testnet"]))));
  const result = await owner.mutation(api.payments.prepare, { jobId }); if (!result.ok) throw Error(result.code);
  const intentId = result.intentId;
  const view = () => owner.query(api.payments.forJob, { jobId });
  const intent = (await view())!;
  const attemptId = intent.currentAttemptId!;
  const token = "a".repeat(64);
  const auth = async (id = attemptId) => owner.mutation(api.payments.authorize, { intentId, recipient: intent.recipient, amountYocto: intent.amountYocto, attemptId: id });
  const claim = (id = attemptId, claimToken = token) => t.mutation(internal.paymentRecoveryWorker.claim, { attemptId: id, token: claimToken });
  const fail = (id = attemptId, claimToken = token) => t.mutation(internal.paymentRecoveryWorker.failure, { attemptId: id, token: claimToken, reason: "TESTNET_CHECK_FAILED" });
  const retryArgs = (id = attemptId, generation = 1, requestId = "recovery-request-000001") => ({ intentId, attemptId: id, generation, recipient: intent.recipient, amountYocto: intent.amountYocto, requestId });
  const receipt = (hash = "1".repeat(32), nonce = 7, amount = intent.amountYocto, recipient = intent.recipient) => ({ final_execution_status: "FINAL",
    transaction: { hash, signer_id: intent.sender, receiver_id: recipient, nonce, actions: [{ Transfer: { deposit: amount } }] },
    transaction_outcome: { block_hash: "3".repeat(32) }, status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }] });
  transport.assertTestnet.mockResolvedValue(undefined);
  transport.rpc.mockImplementation(async method => method === "EXPERIMENTAL_protocol_config" ? { runtime_config: { storage_amount_per_byte: "1" } }
    : method === "send_tx" || method === "tx" ? receipt() : { amount: "10000000000000000000000000", storage_usage: 1 });
  return { t, owner, other, ownerId, missionId, jobId, intentId, intent, attemptId, token, auth, claim, fail, retryArgs, view, receipt };
}
it("closes an actual preflight failure without touching any SDK helper and requires a fresh exact owner confirmation", async () => {
  const s = await setup(); await s.auth(); transport.assertTestnet.mockRejectedValueOnce(Error("offline"));
  await s.t.action(internal.nearRecovery.settle, { attemptId: s.attemptId });
  expect(transport.signerInit).not.toHaveBeenCalled(); expect(transport.create).not.toHaveBeenCalled(); expect(transport.sign).not.toHaveBeenCalled();
  expect(transport.rpc).not.toHaveBeenCalled(); expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
  const failed = (await s.view())!; expect(failed.status).toBe("FAILED"); expect(failed.recovery?.eligible).toBe(true);
  const old = await s.t.run(ctx => ctx.db.get(s.attemptId));
  expect(JSON.stringify(failed)).not.toContain(old!.claimToken); expect(JSON.stringify(failed)).not.toContain("claimToken");
  const replacement = await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs()); if (!replacement.ok) throw Error(replacement.code);
  expect((await s.view())!.status).toBe("READY"); expect((await s.view())!.authorizedAt).toBeUndefined();
  expect(await s.t.run(ctx => ctx.db.get(s.attemptId))).toEqual(old);
  expect(await s.t.action(internal.nearRecovery.settle, { attemptId: replacement.attemptId })).toMatchObject({ ok: false });
  expect(transport.sign).not.toHaveBeenCalled();
  expect(await s.auth(s.attemptId)).toMatchObject({ ok: false, code: "PAYMENT_ATTEMPT_CHANGED" });
  expect(await s.auth(replacement.attemptId)).toEqual({ ok: true });
  await s.t.action(internal.nearRecovery.settle, { attemptId: replacement.attemptId });
  expect(transport.sign).toHaveBeenCalledTimes(1); expect(transport.rpc.mock.calls.filter(call => call[0] === "send_tx")).toHaveLength(1);
  expect((await s.view())!.status).toBe("CONFIRMED"); expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(true);
  expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(2);
});
it("fences an old paused worker from every SDK helper and rejects its stale callbacks after replacement", async () => {
  const s = await setup(); await s.auth();
  let unblock!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  transport.assertTestnet.mockImplementationOnce(() => { entered(); return new Promise<void>(resolve => { unblock = resolve; }); });
  const running = s.t.action(internal.nearRecovery.settle, { attemptId: s.attemptId }); await started;
  const old = (await s.t.run(ctx => ctx.db.get(s.attemptId)))!; const token = old.claimToken!;
  await s.fail(s.attemptId, token);
  const r = await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs()); if (!r.ok) throw Error(r.code);
  unblock(); await running;
  expect(transport.signerInit).not.toHaveBeenCalled(); expect(transport.sign).not.toHaveBeenCalled();
  expect(await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, { attemptId: s.attemptId, token })).toBe(false);
  expect(await s.t.mutation(internal.paymentRecoveryWorker.prepared, { attemptId: s.attemptId, token, txHash: "1".repeat(32), nonce: "7" })).toBe(false);
  expect(await s.t.mutation(internal.paymentRecoveryWorker.broadcastPermit, { attemptId: s.attemptId, token })).toBe(false);
  await s.t.mutation(internal.paymentRecoveryWorker.outcome, { attemptId: s.attemptId, token, receiptJson: JSON.stringify(s.receipt()) });
  await s.fail(s.attemptId, token);
  expect((await s.view())!.currentAttemptId).toBe(r.attemptId); expect((await s.view())!.status).toBe("READY");
  expect((await s.t.run(ctx => ctx.db.get(s.attemptId)))!.phase).toBe("CLOSED_PRE_SIGN_FAILURE");
});
it("handles exact request replay before stale-generation checks and isolates concurrent replacements and owners", async () => {
  const s = await setup(); await s.auth(); await s.claim(); await s.fail();
  await expect(s.other.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).rejects.toThrow("PAYMENT_NOT_FOUND");
  await expect(s.t.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).rejects.toThrow("UNAUTHENTICATED");
  const outcomes = await Promise.all([s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs()), s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())]);
  expect(outcomes[0]).toEqual(outcomes[1]);
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toEqual(outcomes[0]);
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, { ...s.retryArgs(), amountYocto: "1" })).toMatchObject({ ok: false, code: "RECOVERY_REQUEST_CONFLICT" });
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs(s.attemptId, 1, "another-request-000001"))).toMatchObject({ ok: false });
  expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(2);
  expect(await s.t.run(ctx => ctx.db.query("paymentRecoveryRequests").collect())).toHaveLength(1);
});
it("keeps every post-permit failure uncertain, holds its lock and denies retry even without a hash", async () => {
  const s = await setup(); await s.auth(); await s.claim();
  expect(await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, { attemptId: s.attemptId, token: s.token })).toBe(true);
  await s.fail();
  const i = (await s.view())!; expect(i.status).toBe("UNKNOWN_RECONCILE"); expect(i.txHash).toBeUndefined(); expect(i.recovery?.eligible).toBe(false);
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false });
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toHaveLength(1);
  await expect(s.owner.mutation(api.payments.reconcile, { intentId: s.intentId })).rejects.toThrow("NOT_RECONCILABLE");
});
it.each(["signed", "broadcast", "unknown"])("retains %s identity/lock, denies replacement and only reconciles the original hash", async stage => {
  const s = await setup(); await s.auth(); await s.claim(); const input = { attemptId: s.attemptId, token: s.token };
  await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, input);
  await s.t.mutation(internal.paymentRecoveryWorker.prepared, { ...input, txHash: "1".repeat(32), nonce: "7" });
  if (stage !== "signed") await s.t.mutation(internal.paymentRecoveryWorker.broadcastPermit, input);
  if (stage === "unknown") await s.fail();
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false });
  await s.t.action(internal.nearRecovery.settle, { attemptId: s.attemptId });
  expect(transport.sign).not.toHaveBeenCalled(); expect(transport.signerInit).not.toHaveBeenCalled();
  await s.t.action(internal.nearRecovery.reconcile, { attemptId: s.attemptId });
  expect(transport.rpc.mock.calls.some(call => call[0] === "send_tx")).toBe(false);
  expect((await s.view())!.status).toBe("CONFIRMED");
  const releases = (await s.owner.query(api.jobs.detail, { id: s.jobId })).events.filter(e => e.type === "DELIVERABLE_RELEASED"); expect(releases).toHaveLength(1);
  await s.t.action(internal.nearRecovery.reconcile, { attemptId: s.attemptId }); expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).events.filter(e => e.type === "DELIVERABLE_RELEASED")).toHaveLength(1);
});
it("rejects wrong tokens, old unfenced workers and a confirmation without the current immutable attempt", async () => {
  const s = await setup(); await s.auth(); await s.claim();
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId })).toBeNull();
  await expect(s.t.mutation(internal.paymentWorker.prepared, { intentId: s.intentId, txHash: "1".repeat(32), nonce: "7" })).rejects.toThrow("INVALID_PAYMENT_STATE");
  await s.t.mutation(internal.paymentWorker.outcome, { intentId: s.intentId, preBroadcastFailure: true });
  expect((await s.view())!.status).toBe("SUBMITTING");
  expect(await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, { attemptId: s.attemptId, token: "b".repeat(64) })).toBe(false);
  await s.fail(s.attemptId, "b".repeat(64)); expect((await s.view())!.status).toBe("SUBMITTING");
  await s.t.run(ctx => ctx.db.patch(s.intentId, { status: "CONFIRMED", txHash: "1".repeat(32), nonce: "7", blockHash: "3".repeat(32), lastReason: "FINAL_MATCHING_TRANSFER", lastCheckAt: Date.now() }));
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(false);
});
it("rechecks configuration, recipient, output and optional quota policy before preparing a replacement", async () => {
  const s = await setup(); await s.auth(); await s.claim(); await s.fail();
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, { ...s.retryArgs(), recipient: "attacker.testnet" })).toMatchObject({ ok: false });
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "false"); expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false, code: "PAYMENT_RECOVERY_DISABLED" });
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "true"); vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "true");
  vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON", JSON.stringify({ [s.ownerId]: "0" })); vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO", "1000000000000000000000000");
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false });
  vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  await s.t.run(async ctx => { const id = await ctx.db.insert("deliverables", { jobId: s.jobId, attempt: 2, format: "json", content: "{}", createdAt: Date.now() }); await ctx.db.insert("verifications", { jobId: s.jobId, deliverableId: id, verdict: "pass", checks: [], createdAt: Date.now() }); });
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false, code: "PAYMENT_APPROVAL_CHANGED" });
  expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(1);
});
it("enforces five attempts and throttles recovery without deleting history or increasing debt", async () => {
  const s = await setup(); let id: Id<"paymentAttempts"> = s.attemptId;
  for (let generation = 1; generation <= 5; generation++) {
    await s.auth(id); await s.claim(id); await s.fail(id);
    const result = await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs(id, generation, "bounded-retry-request-" + generation));
    if (generation === 5) { expect(result).toMatchObject({ ok: false, code: "PAYMENT_RETRY_LIMIT_REACHED" }); break; }
    if (!result.ok) throw Error(result.code); id = result.attemptId;
    if (generation === 1) {
      await s.auth(id); await s.claim(id); await s.fail(id);
      expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs(id, 2, "too-fast-retry-request"))).toMatchObject({ ok: false, code: "PAYMENT_RECOVERY_RATE_LIMIT" });
    }
    vi.setSystemTime(Date.now() + 16000);
  }
  expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(5);
  expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toEqual(expect.arrayContaining([expect.objectContaining({ phase: "CLOSED_PRE_SIGN_FAILURE" })]));
});
it("requires operator review after an SDK signing failure and never grants a closure based on its error label", async () => {
  const s = await setup(); await s.auth(); transport.sign.mockImplementationOnce(() => { throw Error("fixture SDK error"); });
  await s.t.action(internal.nearRecovery.settle, { attemptId: s.attemptId });
  expect(transport.sign).toHaveBeenCalledTimes(1);
  expect((await s.view())!.status).toBe("UNKNOWN_RECONCILE"); expect((await s.view())!.recovery?.eligible).toBe(false);
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false });
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toHaveLength(1);
});
it("serializes signing/closure races and grants at most one claim and broadcast permit", async () => {
  const s = await setup(); await s.auth();
  const claims = await Promise.all([s.claim(), s.claim(s.attemptId, "b".repeat(64))]); expect(claims.filter(Boolean)).toHaveLength(1);
  const stored = (await s.t.run(ctx => ctx.db.get(s.attemptId)))!; const input = { attemptId: s.attemptId, token: stored.claimToken! };
  await Promise.all([s.t.mutation(internal.paymentRecoveryWorker.signingPermit, input), s.fail(s.attemptId, input.token)]);
  const attempt = (await s.t.run(ctx => ctx.db.get(s.attemptId)))!;
  expect(attempt.phase === "CLOSED_PRE_SIGN_FAILURE" ? attempt.signingStartedAt === undefined : attempt.closedAt === undefined).toBe(true);
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: attempt.phase === "CLOSED_PRE_SIGN_FAILURE" });
  if (attempt.signingStartedAt) {
    expect((await s.view())!.recovery?.eligible).toBe(false);
  }
});
it("rejects inconsistent identity/history rather than clearing evidence for a retry", async () => {
  const s = await setup(); await s.auth(); await s.claim(); await s.fail();
  await s.t.run(ctx => ctx.db.patch(s.intentId, { txHash: "1".repeat(32) }));
  expect((await s.view())!.recovery?.eligible).toBe(false);
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false });
  await s.t.run(async ctx => { await ctx.db.patch(s.intentId, { txHash: undefined }); await ctx.db.patch(s.attemptId, { generation: 2 }); });
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false });
  expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toHaveLength(1);
});
it("preserves legacy failed records and requires the whole exact parent/child settlement before release", async () => {
  const s = await setup(true); const detail = await s.owner.query(api.jobs.detail, { id: s.jobId }); const childId = detail.children[0]._id;
  const childPrepared = await s.owner.mutation(api.payments.prepare, { jobId: childId }); if (!childPrepared.ok) throw Error(childPrepared.code);
  const childIntent = (await s.owner.query(api.payments.forJob, { jobId: childId }))!;
  await s.auth(); await s.claim(); const input = { attemptId: s.attemptId, token: s.token };
  await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, input); await s.t.mutation(internal.paymentRecoveryWorker.prepared, { ...input, txHash: "1".repeat(32), nonce: "7" });
  const permits = await Promise.all([s.t.mutation(internal.paymentRecoveryWorker.broadcastPermit, input), s.t.mutation(internal.paymentRecoveryWorker.broadcastPermit, input)]); expect(permits.filter(Boolean)).toHaveLength(1);
  await s.t.mutation(internal.paymentRecoveryWorker.outcome, { ...input, receiptJson: JSON.stringify(s.receipt()) });
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(false);
  await s.owner.mutation(api.payments.authorize, { intentId: childIntent._id, attemptId: childIntent.currentAttemptId, recipient: childIntent.recipient, amountYocto: childIntent.amountYocto });
  const childInput = { attemptId: childIntent.currentAttemptId!, token: "b".repeat(64) };
  await s.t.mutation(internal.paymentRecoveryWorker.claim, childInput); await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, childInput);
  await s.t.mutation(internal.paymentRecoveryWorker.prepared, { ...childInput, txHash: "2".repeat(32), nonce: "8" });
  await s.t.mutation(internal.paymentRecoveryWorker.broadcastPermit, childInput);
  await s.t.mutation(internal.paymentRecoveryWorker.outcome, { ...childInput, receiptJson: JSON.stringify(s.receipt("2".repeat(32), 8, childIntent.amountYocto, childIntent.recipient)) });
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(true);
  expect(BigInt(s.intent.amountYocto) + BigInt(childIntent.amountYocto)).toBe(BigInt(detail.job.reservedYocto));
  // A pre-v2 failed intent is never promoted or given a synthetic closure.
  await s.t.run(ctx => ctx.db.patch(s.intentId, { recoveryVersion: undefined, currentAttemptId: undefined, attemptCount: undefined, status: "FAILED" }));
  expect((await s.view())!.recovery).toBeNull();
  expect(await s.owner.mutation(api.paymentRecovery.prepareRetry, s.retryArgs())).toMatchObject({ ok: false, code: "PAYMENT_RETRY_NOT_PROVEN_SAFE" });
});
it.each(["hash", "nonce"] as const)("rejects a %s identity already recorded for another historical obligation", async collision => {
  const s = await setup(); await s.auth(); await s.claim(); const input = { attemptId: s.attemptId, token: s.token };
  await s.t.mutation(internal.paymentRecoveryWorker.signingPermit, input);
  await s.t.run(async ctx => {
    const missionId = await ctx.db.insert("missions", { ownerId: s.ownerId, title: "Historical identity fixture", serviceType: "csv_summary", inputCsv: "x\n1", maxBudgetYocto: "1000000000000000000000000", acceptanceCriteria: "Fixture", deadlineAt: Date.now() + 100000, state: "active", createdAt: Date.now(), updatedAt: Date.now() });
    const jobId = await ctx.db.insert("jobs", { ownerId: s.ownerId, missionId, depth: 0, serviceType: "csv_summary", inputCsv: "x\n1", options: { columns: ["x"] }, budgetYocto: "1000000000000000000000000", reservedYocto: s.intent.amountYocto, state: "approved", revisionCount: 0, createdAt: Date.now(), updatedAt: Date.now() });
    const bidId = await ctx.db.insert("bids", { jobId, agentId: "stats-core", priceYocto: s.intent.amountYocto, minimumYocto: "1", etaMs: 1, rationale: "Fixture", createdAt: Date.now() });
    const contractId = await ctx.db.insert("contracts", { jobId, agentId: "stats-core", bidId, amountYocto: s.intent.amountYocto, holdbackYocto: s.intent.amountYocto, state: "completed", selectionReason: "Fixture", createdAt: Date.now() });
    // Historical identity remains protective even without modern approval bindings.
    await ctx.db.insert("paymentIntents", { jobId, ownerId: s.ownerId, contractId, sender: s.intent.sender, recipient: s.intent.recipient,
      amountYocto: s.intent.amountYocto, network: "testnet", status: "UNKNOWN_RECONCILE", txHash: (collision === "hash" ? "1" : "2").repeat(32), nonce: collision === "nonce" ? "7" : "6", createdAt: Date.now() });
  });
  expect(await s.t.mutation(internal.paymentRecoveryWorker.prepared, { ...input, txHash: "1".repeat(32), nonce: "7" })).toBe(false);
  expect((await s.view())!.txHash).toBeUndefined(); expect((await s.view())!.recovery?.eligible).toBe(false);
});
it("rolls back the stable intent when initial attempt persistence fails", async () => {
  const s = await setup();
  const missionId = await s.owner.mutation(api.missions.duplicate, { id: s.missionId });
  const jobId = await s.owner.mutation(api.jobs.start, { missionId, allowUnfundedPreview: true });
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  const failure = vi.spyOn(recoveryHelpers, "appendAttempt").mockRejectedValueOnce(Error("INJECTED_ATTEMPT_PERSISTENCE_FAILURE"));
  try {
    await expect(s.owner.mutation(api.payments.prepare, { jobId })).rejects.toThrow("INJECTED_ATTEMPT_PERSISTENCE_FAILURE");
    expect(await s.owner.query(api.payments.forJob, { jobId })).toBeNull();
  } finally { failure.mockRestore(); }
});

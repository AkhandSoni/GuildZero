import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { masterFixture } from "../helpers/master-fixtures";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
import type { MasterAgentPlanV1 } from "../../lib/master-agent/plan";

const modules = import.meta.glob("../../convex/**/*.ts");
const noSend = vi.hoisted(() => ({ rpc: vi.fn(() => { throw Error("NO_NETWORK_ALLOWED"); }), signer: vi.fn(() => { throw Error("NO_SIGNER_ALLOWED"); }) }));
vi.mock("../../lib/settlement/rpc", () => ({ rpc: noSend.rpc, assertTestnet: noSend.rpc, TESTNET_RPC: "https://rpc.testnet.near.org" }));
vi.mock("near-api-js", () => ({ KeyPairSigner: { fromSecretKey: noSend.signer }, Account: class { constructor() { noSend.signer(); } }, JsonRpcProvider: class {}, actions: {}, baseEncode: () => "" }));
// Run the actual scheduled economy and automatic intent authorization, but never
// execute settlement. Actual SDK admission/receipt coverage lives in process tests.
vi.mock("../../convex/nearSettlement", async () => {
  const { internalAction } = await import("../../convex/_generated/server");
  const { v } = await import("convex/values");
  return { settle: internalAction({ args: { intentId: v.id("paymentIntents") }, handler: async () => null }) };
});
afterEach(() => {
  expect(noSend.rpc).not.toHaveBeenCalled(); expect(noSend.signer).not.toHaveBeenCalled();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks();
});

async function setup(mode: "automatic" | "preview" = "automatic", fixture = "summary", humanReview = false) {
  vi.useFakeTimers();
  vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", mode === "automatic" ? "true" : "false");
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", mode === "automatic" ? "true" : "false");
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "false"); vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  vi.stubEnv("NEAR_NETWORK", "testnet"); vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "start-fixture.testnet");
  vi.stubEnv("NEAR_PRIVATE_KEY", "unusable-offline-fixture");
  vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify(Object.fromEntries(PUBLIC_AGENTS.filter(a => a.capabilities.length).map(a => [a.id, `${a.id}.start-fixture.testnet`]))));
  const t = testBackend(schema, modules);
  const [ownerId, otherId] = await t.run(ctx => Promise.all([
    ctx.db.insert("users", { email: "start-owner@example.test" }), ctx.db.insert("users", { email: "start-other@example.test" }),
  ]));
  const owner = await asUser(t, ownerId), other = await asUser(t, otherId);
  const { context, plan } = masterFixture(fixture);
  const input = { requestId: "offline-human-start-request", prompt: context.prompt, datasets: context.datasets,
    capYocto: context.capYocto, deadlineAt: context.deadlineAt, requiresHumanReview: humanReview };
  const review = await owner.query(api.masterStart.review, {});
  const args = { ...input, mode, policyHash: mode === "automatic" ? review.policyHash : review.previewPolicyHash,
    expiresAt: review.expiresAt, purpose: "human_start_and_pay_verified" as const };
  const runId = await owner.mutation(api.masterStart.start, args);
  const raw = () => t.run(ctx => ctx.db.get(runId));
  const view = () => owner.query(api.masterAgent.get, { runId });
  const claim = () => owner.mutation(api.masterAgent.beginPlanning, { runId, revision: 1 });
  const finish = (token: string, proposal: unknown = plan) => owner.mutation(api.masterAgent.finishPlanning, { runId, revision: 1, token, planJson: JSON.stringify(proposal) });
  const propose = async (proposal: unknown = plan) => finish((await claim()).token, proposal);
  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const grants = () => t.run(ctx => ctx.db.query("masterGrants").collect());
  const assertNoWork = async () => {
    expect(await t.run(ctx => ctx.db.query("missions").collect())).toEqual([]);
    expect(await grants()).toEqual([]); expect(await t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
  };
  return { t, owner, other, ownerId, otherId, input, args, runId, plan, raw, view, claim, finish, propose, drain, grants, assertNoWork };
}

it("requires authenticated Start and isolates pending consent and completion by owner", async () => {
  const s = await setup();
  await expect(s.t.query(api.masterStart.review, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(s.t.mutation(api.masterStart.start, s.args)).rejects.toThrow("UNAUTHENTICATED");
  const claim = await s.claim();
  await expect(s.other.mutation(api.masterAgent.finishPlanning, { runId: s.runId, revision: 1, token: claim.token, planJson: JSON.stringify(s.plan) })).rejects.toThrow("NOT_FOUND");
  await expect(s.other.mutation(api.masterStart.abortPlanning, { runId: s.runId, revision: 1 })).rejects.toThrow("NOT_FOUND");
  expect((await s.raw())!.startConsent?.revokedAt).toBeUndefined(); await s.assertNoWork();
});
it("replays duplicate Start without creating another request or changing its original expiry", async () => {
  const s = await setup(); const original = (await s.raw())!.startConsent!;
  const ids = await Promise.all([s.owner.mutation(api.masterStart.start, s.args), s.owner.mutation(api.masterStart.start, s.args)]);
  expect(ids).toEqual([s.runId, s.runId]); expect(await s.t.run(ctx => ctx.db.query("masterRuns").collect())).toHaveLength(1);
  expect((await s.raw())!.startConsent).toEqual(original);
  await expect(s.owner.mutation(api.masterStart.start, { ...s.args, expiresAt: s.args.expiresAt - 1 })).rejects.toThrow("REQUEST_ID_CONFLICT");
  await expect(s.owner.mutation(api.masterStart.start, { ...s.args, capYocto: "1" })).rejects.toThrow("REQUEST_ID_CONFLICT");
});
it("does not renew a revoked or expired Start on replay", async () => {
  const s = await setup(); await s.owner.mutation(api.masterAgent.revokeSpending, { runId: s.runId });
  const original = (await s.raw())!.startConsent!;
  expect(await s.owner.mutation(api.masterStart.start, s.args)).toBe(s.runId);
  expect((await s.raw())!.startConsent).toEqual(original);
  vi.setSystemTime(s.args.expiresAt + 1);
  expect(await s.owner.mutation(api.masterStart.start, s.args)).toBe(s.runId);
  expect((await s.raw())!.startConsent).toEqual(original);
  await expect(s.claim()).rejects.toThrow("START_AUTHORIZATION_INACTIVE"); await s.assertNoWork();
});
it("cannot upgrade a legacy planning request by colliding with its request identity", async () => {
  const s = await setup("preview");
  const input = { ...s.input, requestId: "legacy-human-request-identity" };
  const legacyId = await s.owner.mutation(api.masterAgent.create, input);
  await expect(s.owner.mutation(api.masterStart.start, { ...s.args, ...input })).rejects.toThrow("REQUEST_ID_CONFLICT");
  const claim = await s.owner.mutation(api.masterAgent.beginPlanning, { runId: legacyId, revision: 1 });
  expect(await s.owner.mutation(api.masterAgent.finishPlanning, { runId: legacyId, revision: 1, token: claim.token, planJson: JSON.stringify(s.plan),
    inference: { provider: "groq", model: "fabricated-metadata-is-not-authority", inferenceMs: 1, requests: 1, inputTokens: null, outputTokens: null, planningMs: 1 } })).toMatchObject({ ok: true });
  expect((await s.owner.query(api.masterAgent.get, { runId: legacyId })).run.state).toBe("ready_to_accept"); await s.assertNoWork();
});
for (const setting of ["flag", "retry", "missing-key", "cap"] as const) {
  it(`blocks a new automatic Start when ${setting} policy is unavailable`, async () => {
    const s = await setup();
    if (setting === "flag") vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "false");
    if (setting === "retry") vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "true");
    if (setting === "missing-key") vi.stubEnv("NEAR_PRIVATE_KEY", "");
    if (setting === "cap") vi.stubEnv("NEAR_MAX_TRANSFER_YOCTO", "0");
    expect((await s.owner.query(api.masterStart.review, {})).enabled).toBe(false);
    await expect(s.owner.mutation(api.masterStart.start, { ...s.args, requestId: "second-automatic-start-identity" })).rejects.toThrow();
    expect(await s.t.run(ctx => ctx.db.query("masterRuns").collect())).toHaveLength(1); await s.assertNoWork();
  });
}
for (const setting of ["policy", "cap", "request", "dataset", "review", "expiry", "flag", "retry"] as const) {
  it(`blocks ${setting} changes between human Start and returned model plan`, async () => {
    const s = await setup(); const claim = await s.claim();
    if (setting === "policy") vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify({ "stats-core": "substituted.testnet" }));
    if (setting === "cap") vi.stubEnv("NEAR_MAX_TRANSFER_YOCTO", "500000000000000000000000");
    if (setting === "request") await s.t.run(ctx => ctx.db.patch(s.runId, { prompt: "Changed after consent" }));
    if (setting === "review") await s.t.run(ctx => ctx.db.patch(s.runId, { requiresHumanReview: true }));
    if (setting === "dataset") await s.t.run(async ctx => { const run = (await ctx.db.get(s.runId))!; await ctx.db.patch(s.runId, { datasets: run.datasets.map(d => ({ ...d, csv: d.csv + "\n" })) }); });
    if (setting === "expiry") await s.t.run(async ctx => { const run = (await ctx.db.get(s.runId))!; await ctx.db.patch(s.runId, { startConsent: { ...run.startConsent!, expiresAt: Date.now() - 1 } }); });
    if (setting === "flag") vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "false");
    if (setting === "retry") vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "true");
    expect(await s.finish(claim.token)).toMatchObject({ ok: false });
    expect((await s.raw())!.startConsent?.revokedAt).toBeDefined(); await s.assertNoWork();
  });
}
for (const operation of ["revoke", "cancel", "abort"] as const) {
  it(`prevents late planning from creating work after ${operation} during inference`, async () => {
    const s = await setup(); const claim = await s.claim();
    if (operation === "revoke") await s.owner.mutation(api.masterAgent.revokeSpending, { runId: s.runId });
    if (operation === "cancel") await s.owner.mutation(api.masterAgent.cancel, { runId: s.runId });
    if (operation === "abort") await s.owner.mutation(api.masterStart.abortPlanning, { runId: s.runId, revision: 1 });
    await expect(s.finish(claim.token)).rejects.toThrow("STALE"); await s.assertNoWork();
  });
}
it("invalid output and ambiguity revoke unused authority instead of executing invented work", async () => {
  const s = await setup();
  expect(await s.propose({ ...s.plan, recipient: "attacker.testnet" })).toMatchObject({ ok: false });
  expect((await s.raw())!.startConsent?.revokedAt).toBeDefined(); await s.assertNoWork();
  const a = await setup("automatic", "ambiguous"); await a.propose();
  expect((await a.view()).run.state).toBe("needs_clarification");
  expect((await a.raw())!.startConsent?.revokedAt).toBeDefined();
  await a.owner.mutation(api.masterAgent.clarify, { runId: a.runId, reply: "Summarize the units column." });
  await expect(a.owner.mutation(api.masterAgent.beginPlanning, { runId: a.runId, revision: 2 })).rejects.toThrow("START_AUTHORIZATION_INACTIVE"); await a.assertNoWork();
});
it("removes revoked pending request content without leaving later execution authority", async () => {
  const s = await setup(); const claim = await s.claim();
  await s.owner.mutation(api.masterAgent.cancel, { runId: s.runId });
  await s.owner.mutation(api.masterAgent.removeContent, { runId: s.runId, confirm: "REMOVE_PLANNER_AND_MISSION_CONTENT" });
  expect((await s.raw())!.startConsent?.revokedAt).toBeDefined();
  await expect(s.finish(claim.token)).rejects.toThrow("STALE"); await s.assertNoWork();
});
it("rejects over-budget or nonexistent-column plans without partial mission or grant writes", async () => {
  for (const invalid of ["budget", "column"] as const) {
    const s = await setup(); const plan: MasterAgentPlanV1 = structuredClone(s.plan);
    if (invalid === "budget") { plan.steps[0].maxBudgetYocto = "1000000000000000000000001"; plan.proposedTotalBudgetYocto = plan.steps[0].maxBudgetYocto; }
    else plan.steps[0].options.columns = ["nonexistent_column"];
    expect(await s.propose(plan)).toMatchObject({ ok: false }); await s.assertNoWork();
  }
});
it("one Start preview processes real data and verification without accept or spending authority", async () => {
  const s = await setup("preview"); expect(await s.propose()).toMatchObject({ ok: true }); await s.drain();
  const view = await s.view(); expect(view.steps).toHaveLength(1); expect(view.run.acceptedAt).not.toBeNull();
  const detail = await s.owner.query(api.jobs.detail, { id: view.steps[0].jobId! });
  expect(detail.job.state).toBe("approved"); expect(detail.bids.length).toBeGreaterThanOrEqual(2);
  expect(detail.verifications[0].verdict).toBe("pass"); expect(detail.delivery.released).toBe(false); expect(detail.deliverables[0].content).toBeNull();
  expect(await s.grants()).toEqual([]); expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
});
it("one valid automatic Start creates one exact linked grant and authorizes only verified work", async () => {
  const s = await setup(); const claim = await s.claim(); expect(await s.finish(claim.token)).toMatchObject({ ok: true });
  await expect(s.finish(claim.token)).rejects.toThrow("STALE");
  await s.t.mutation(internal.masterStart.admit, { runId: s.runId }); await s.drain();
  const view = await s.view(), grants = await s.grants(); expect(view.steps).toHaveLength(1); expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ runId: s.runId, capYocto: s.plan.proposedTotalBudgetYocto, startConsentHash: (await s.raw())!.startConsent!.hash, expiresAt: s.args.expiresAt });
  const intent = (await s.owner.query(api.payments.forJob, { jobId: view.steps[0].jobId! }))!;
  expect(intent.masterGrantId).toBe(grants[0]._id); expect(intent.authorizedAt).toBeDefined(); expect(intent.status).toBe("READY");
  expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
  expect((await s.owner.query(api.jobs.detail, { id: view.steps[0].jobId! })).delivery.released).toBe(false);
});
it("human-review disputes pause automatic settlement without fabricating an approval", async () => {
  const s = await setup("automatic", "summary", true); await s.propose(); await s.drain();
  const view = await s.view(); expect(view.run.state).toBe("needs_human_review");
  expect((await s.owner.query(api.jobs.detail, { id: view.steps[0].jobId! })).job.state).toBe("disputed");
  expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
  expect(await s.t.run(ctx => ctx.db.query("masterReservations").collect())).toEqual([]);
});
it("a clarification after a stalled planning lease cannot reuse its previous Start consent", async () => {
  const s = await setup(); const claim = await s.claim(); vi.setSystemTime(Date.now() + 46000);
  await s.owner.mutation(api.masterAgent.clarify, { runId: s.runId, reply: "Use the units column only." });
  expect((await s.raw())!.startConsent?.revokedAt).toBeDefined();
  await expect(s.finish(claim.token)).rejects.toThrow("STALE"); await s.assertNoWork();
});
for (const change of ["mandate-revoked", "configured-cap", "grant-link"] as const) {
  it(`rechecks ${change} independently of the copied grant before signer claim`, async () => {
    const s = await setup(); await s.propose(); await s.drain();
    const view = await s.view(), grant = (await s.grants())[0];
    const intent = (await s.owner.query(api.payments.forJob, { jobId: view.steps[0].jobId! }))!;
    if (change === "mandate-revoked") await s.t.run(async ctx => { const run = (await ctx.db.get(s.runId))!; await ctx.db.patch(s.runId, { startConsent: { ...run.startConsent!, revokedAt: Date.now() } }); });
    // Still above the real award: this must fail policy binding, not just amount.
    if (change === "configured-cap") vi.stubEnv("NEAR_MAX_TRANSFER_YOCTO", "900000000000000000000000");
    if (change === "grant-link") await s.t.run(ctx => ctx.db.patch(grant._id, { startConsentHash: "different-human-start" }));
    expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: intent._id })).toBeNull();
    expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
    expect((await s.owner.query(api.payments.forJob, { jobId: view.steps[0].jobId! }))!.authorizedAt).toBeUndefined();
  });
}
it("rechecks Start revocation after claim before admitting any signature", async () => {
  const s = await setup(); await s.propose(); await s.drain(); const jobId = (await s.view()).steps[0].jobId!;
  const intent = (await s.owner.query(api.payments.forJob, { jobId }))!;
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: intent._id })).not.toBeNull();
  await s.owner.mutation(api.masterAgent.revokeSpending, { runId: s.runId });
  expect(await s.t.mutation(internal.paymentWorker.masterSigningPermit, { intentId: intent._id })).toBe(false);
  expect((await s.t.run(ctx => ctx.db.get(intent._id)))!.masterSigningAdmittedAt).toBeUndefined();
});
it("keeps automatic parent and cleaning allocations inside the single Start cap", async () => {
  const s = await setup("automatic", "clean-summary"); await s.propose(); await s.drain();
  const jobId = (await s.view()).steps[0].jobId!, grant = (await s.grants())[0];
  const detail = await s.owner.query(api.jobs.detail, { id: jobId }); expect(detail.children).toHaveLength(1);
  await s.t.mutation(internal.masterAgentWorker.authorize, { grantId: grant._id, jobId: detail.children[0]._id });
  const reservations = await s.t.run(ctx => ctx.db.query("masterReservations").collect());
  expect(reservations).toHaveLength(2);
  const total = reservations.reduce((sum, r) => sum + BigInt(r.amountYocto), 0n);
  expect(total).toBe(BigInt(detail.contracts[0].amountYocto)); expect(total <= BigInt(s.args.capYocto)).toBe(true);
  await expect(s.t.mutation(internal.masterAgentWorker.authorize, { grantId: grant._id, jobId })).rejects.toThrow();
  expect(await s.t.run(ctx => ctx.db.query("masterReservations").collect())).toHaveLength(2);
});
for (const mode of ["preview", "automatic"] as const) {
  it(`cannot upgrade or revive a ${mode} Start through legacy public acceptance/grant APIs`, async () => {
    const s = await setup(mode); await s.propose(); await s.drain();
    if (mode === "automatic") await s.owner.mutation(api.masterAgent.revokeSpending, { runId: s.runId });
    else { vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "true"); vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true"); }
    const before = await s.grants(), view = await s.view();
    const review = (await s.owner.query(api.masterAgent.spendingReview, { runId: s.runId }))!;
    expect(review).not.toBeNull();
    await expect(s.owner.mutation(api.masterAgent.accept, { runId: s.runId, planHash: view.run.planHash!, allowUnfundedPreview: true })).rejects.toThrow("START_REQUIRES_NEW_REQUEST");
    await expect(s.owner.mutation(api.masterAgent.authorizeSpending, { runId: s.runId, planHash: review.planHash,
      policyHash: review.policyHash, capYocto: review.capYocto, expiresAt: review.expiresAt, purpose: "human_mission_spending" })).rejects.toThrow("START_REQUIRES_NEW_REQUEST");
    expect(await s.grants()).toEqual(before); expect((await s.view()).steps).toHaveLength(1);
    if (mode === "preview") expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
    else expect((await s.raw())!.startConsent?.revokedAt).toBeDefined();
  });
}
for (const phase of ["claim", "signing-permit"] as const) {
  it(`rejects an automatic grant with its original Start link stripped before ${phase}`, async () => {
    const s = await setup(); await s.propose(); await s.drain();
    const jobId = (await s.view()).steps[0].jobId!, grant = (await s.grants())[0];
    const intent = (await s.owner.query(api.payments.forJob, { jobId }))!;
    if (phase === "signing-permit") expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: intent._id })).not.toBeNull();
    await s.t.run(ctx => ctx.db.patch(grant._id, { startConsentHash: undefined }));
    if (phase === "claim") {
      expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: intent._id })).toBeNull();
      expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
    }
    expect(await s.t.mutation(internal.paymentWorker.masterSigningPermit, { intentId: intent._id })).toBe(false);
    expect((await s.t.run(ctx => ctx.db.get(intent._id)))!.masterSigningAdmittedAt).toBeUndefined();
    expect((await s.owner.query(api.jobs.detail, { id: jobId })).delivery.released).toBe(false);
  });
}

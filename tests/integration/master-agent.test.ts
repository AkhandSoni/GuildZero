import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { masterFixture } from "../helpers/master-fixtures";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
const modules = import.meta.glob("../../convex/**/*.ts");
// Never contact a blockchain or initialize a signer in these integration tests.
vi.mock("../../lib/settlement/rpc", () => ({ TESTNET_RPC: "https://rpc.testnet.near.org", rpc: async () => { throw Error("OFFLINE_FIXTURE"); }, assertTestnet: async () => { throw Error("OFFLINE_FIXTURE"); } }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup(id = "summary") {
  vi.useFakeTimers(); vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "false"); vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "false");
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "false"); vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  const t = testBackend(schema, modules);
  const [ownerId, otherId] = await t.run(ctx => Promise.all([ctx.db.insert("users", { email: "planner-owner@example.com" }), ctx.db.insert("users", { email: "planner-other@example.com" })]));
  const owner = await asUser(t, ownerId), other = await asUser(t, otherId);
  const { context, plan } = masterFixture(id);
  const input = { requestId: "fixture-request-" + id, prompt: context.prompt, datasets: context.datasets,
    capYocto: context.capYocto, deadlineAt: context.deadlineAt, requiresHumanReview: context.requiresHumanReview };
  const runId = await owner.mutation(api.masterAgent.create, input);
  const propose = async (proposal = plan, revision = 1) => {
    const claim = await owner.mutation(api.masterAgent.beginPlanning, { runId, revision });
    return owner.mutation(api.masterAgent.finishPlanning, { runId, revision, token: claim.token, planJson: JSON.stringify(proposal) });
  };
  const view = () => owner.query(api.masterAgent.get, { runId });
  const accept = async () => owner.mutation(api.masterAgent.accept, { runId, planHash: (await view()).run.planHash!, allowUnfundedPreview: true });
  const execute = async () => { await propose(); await accept(); await t.finishAllScheduledFunctions(vi.runAllTimers); };
  const enable = () => {
    vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "true"); vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true"); vi.stubEnv("NEAR_NETWORK", "testnet");
    vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet"); vi.stubEnv("NEAR_PRIVATE_KEY", "unusable-offline-fixture");
    vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify(Object.fromEntries(PUBLIC_AGENTS.filter(a => a.capabilities.length).map(a => [a.id, a.id + ".operator.testnet"]))));
  };
  const authorizeGrant = async () => {
    const review = (await owner.query(api.masterAgent.spendingReview, { runId }))!;
    const args = { runId, planHash: review.planHash, policyHash: review.policyHash, capYocto: review.capYocto, expiresAt: review.expiresAt, purpose: "human_mission_spending" as const };
    return { args, grantId: await owner.mutation(api.masterAgent.authorizeSpending, args) };
  };
  return { t, owner, other, ownerId, otherId, runId, context, plan, input, propose, view, accept, execute, enable, authorizeGrant };
}

it("isolates requests, contexts, proposals, grants and mutations by authenticated owner", async () => {
  const s = await setup();
  for (const client of [s.other, s.t]) {
    await expect(client.query(api.masterAgent.get, { runId: s.runId })).rejects.toThrow();
    await expect(client.query(api.masterAgent.context, { runId: s.runId })).rejects.toThrow();
    await expect(client.mutation(api.masterAgent.beginPlanning, { runId: s.runId, revision: 1 })).rejects.toThrow();
    await expect(client.mutation(api.masterAgent.cancel, { runId: s.runId })).rejects.toThrow();
    await expect(client.mutation(api.masterAgent.revokeSpending, { runId: s.runId })).rejects.toThrow();
  }
  expect(await s.other.query(api.masterAgent.list, {})).toEqual([]);
  expect(JSON.stringify(await s.view())).not.toContain("planningClaimToken");
});
it("uses owner-scoped durable request idempotency and rejects changed payload replay", async () => {
  const s = await setup();
  expect(await s.owner.mutation(api.masterAgent.create, s.input)).toBe(s.runId);
  await expect(s.owner.mutation(api.masterAgent.create, { ...s.input, capYocto: "1" })).rejects.toThrow("REQUEST_ID_CONFLICT");
  expect(await s.other.mutation(api.masterAgent.create, s.input)).not.toBe(s.runId);
});
it("requires current revision and token, bounds attempts and keeps invalid output non-executable", async () => {
  const s = await setup();
  const claim = await s.owner.mutation(api.masterAgent.beginPlanning, { runId: s.runId, revision: 1 });
  await expect(s.owner.mutation(api.masterAgent.beginPlanning, { runId: s.runId, revision: 1 })).rejects.toThrow("PLANNING_NOT_AVAILABLE");
  await expect(s.owner.mutation(api.masterAgent.finishPlanning, { runId: s.runId, revision: 1, token: "wrong", planJson: JSON.stringify(s.plan) })).rejects.toThrow("STALE");
  expect(await s.owner.mutation(api.masterAgent.finishPlanning, { runId: s.runId, revision: 1, token: claim.token, planJson: JSON.stringify({ ...s.plan, approvePayment: true }) })).toMatchObject({ ok: false });
  expect((await s.view()).run.state).toBe("failed"); expect((await s.view()).steps).toHaveLength(0);
  expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
});
it("clarifies without creating work, invalidates old responses and preserves human review", async () => {
  const s = await setup("ambiguous"); await s.propose();
  expect((await s.view()).run.state).toBe("needs_clarification"); expect((await s.view()).steps).toHaveLength(0);
  expect(await s.owner.mutation(api.masterAgent.clarify, { runId: s.runId, reply: "Summarize units and revenue." })).toBe(2);
  await expect(s.owner.mutation(api.masterAgent.beginPlanning, { runId: s.runId, revision: 1 })).rejects.toThrow();
  const plan = masterFixture().plan;
  await s.propose(plan, 2); await s.accept(); await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await s.view()).run.state).toBe("awaiting_spending_authorization");
});
for (const id of ["summary", "cleaning", "quality", "reconciliation", "grouped", "multi-step", "clean-summary"]) {
  it(`compiles the ${id} gold proposal through actual scheduled marketplace services without paying`, async () => {
    const s = await setup(id); await s.execute();
    const view = await s.view();
    expect(view.steps).toHaveLength(s.plan.steps.length); expect(view.run.state).toBe("awaiting_spending_authorization");
    for (const step of view.steps) {
      const job = await s.owner.query(api.jobs.detail, { id: step.jobId! });
      expect(job.job.state).toBe("approved"); expect(job.bids.length).toBeGreaterThanOrEqual(2);
      expect(job.verifications[0].verdict).toBe("pass"); expect(job.deliverables[0].content).toBeNull();
      if (id === "clean-summary") expect(job.children).toHaveLength(1);
    }
    expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
    await Promise.all([s.accept(), s.accept()]); expect((await s.view()).steps).toHaveLength(s.plan.steps.length);
  });
}
it("does not hide a disputed service or let a model/human plan switch disable mandatory review", async () => {
  const s = await setup(); await s.t.run(ctx => ctx.db.patch(s.runId, { requiresHumanReview: true }));
  await s.propose(); await s.accept(); await s.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await s.view()).run.state).toBe("needs_human_review");
  expect(await s.t.run(ctx => ctx.db.query("masterGrants").collect())).toEqual([]);
});
it("requires a separate human grant and exact displayed scope; rollout stays disabled by default", async () => {
  const s = await setup(); await s.execute(); s.enable(); vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "false");
  const review = (await s.owner.query(api.masterAgent.spendingReview, { runId: s.runId }))!;
  const args = { runId: s.runId, planHash: review.planHash, policyHash: review.policyHash, capYocto: review.capYocto, expiresAt: review.expiresAt, purpose: "human_mission_spending" as const };
  await expect(s.owner.mutation(api.masterAgent.authorizeSpending, args)).rejects.toThrow("DISABLED");
  vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "true");
  await expect(s.other.mutation(api.masterAgent.authorizeSpending, args)).rejects.toThrow("NOT_FOUND");
  await expect(s.owner.mutation(api.masterAgent.authorizeSpending, { ...args, capYocto: "2" })).rejects.toThrow("SCOPE_CHANGED");
  await expect(s.owner.mutation(api.masterAgent.authorizeSpending, { ...args, expiresAt: Date.now() + 7200000 })).rejects.toThrow("SCOPE_CHANGED");
  const a = await s.owner.mutation(api.masterAgent.authorizeSpending, args);
  expect(await s.owner.mutation(api.masterAgent.authorizeSpending, args)).toBe(a);
  expect(await s.t.run(ctx => ctx.db.query("paymentIntents").collect())).toEqual([]);
});

async function admitted(id = "summary") {
  const s = await setup(id); await s.execute(); s.enable();
  const { grantId } = await s.authorizeGrant(); const view = await s.view();
  const jobId = view.steps[0].jobId!;
  await s.t.mutation(internal.masterAgentWorker.authorize, { grantId, jobId });
  const intent = (await s.owner.query(api.payments.forJob, { jobId }))!;
  return { ...s, grantId, jobId, intent };
}
it("reserves once and rejects duplicate automatic authorization without rearming intent", async () => {
  const s = await admitted();
  await expect(s.t.mutation(internal.masterAgentWorker.authorize, { grantId: s.grantId, jobId: s.jobId })).rejects.toThrow();
  const rows = await s.t.run(ctx => ctx.db.query("masterReservations").collect()); expect(rows).toHaveLength(1);
  expect(rows[0].amountYocto).toBe(s.intent.amountYocto);
  expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!.masterGrantId).toBe(s.grantId);
});
for (const change of ["revoked", "expired", "policy", "dataset", "plan", "quota"] as const) {
  it(`blocks ${change} authorization before the signer claim`, async () => {
    const s = await admitted();
    if (change === "revoked") await s.owner.mutation(api.masterAgent.revokeSpending, { runId: s.runId });
    if (change === "expired") vi.setSystemTime(Date.now() + 3600001);
    if (change === "policy") vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify({ "stats-core": "changed.operator.testnet" }));
    if (change === "dataset") await s.t.run(async ctx => { const r = (await ctx.db.get(s.runId))!; await ctx.db.patch(s.runId, { datasets: r.datasets.map(d => ({ ...d, csv: d.csv + "\n" })) }); });
    if (change === "plan") await s.t.run(ctx => ctx.db.patch(s.runId, { planHash: "changed" }));
    if (change === "quota") vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "true");
    expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intent._id })).toBeNull();
    expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
    expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!.authorizedAt).toBeUndefined();
  });
}
it("rechecks revocation after preflight and before any signing is admitted", async () => {
  const s = await admitted(); expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intent._id })).not.toBeNull();
  await s.owner.mutation(api.masterAgent.revokeSpending, { runId: s.runId });
  expect(await s.t.mutation(internal.paymentWorker.masterSigningPermit, { intentId: s.intent._id })).toBe(false);
  expect((await s.t.run(ctx => ctx.db.get(s.intent._id)))!.masterSigningAdmittedAt).toBeUndefined();
});
it("fences a single signing admission and retains uncertainty for original-hash reconciliation", async () => {
  const s = await admitted(); await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intent._id });
  expect(await s.t.mutation(internal.paymentWorker.masterSigningPermit, { intentId: s.intent._id })).toBe(true);
  expect(await s.t.mutation(internal.paymentWorker.masterSigningPermit, { intentId: s.intent._id })).toBe(false);
  await s.t.mutation(internal.paymentWorker.prepared, { intentId: s.intent._id, txHash: "1".repeat(32), nonce: "7" });
  await s.t.mutation(internal.paymentWorker.outcome, { intentId: s.intent._id });
  expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!.status).toBe("UNKNOWN_RECONCILE");
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toHaveLength(1);
  await expect(s.t.mutation(internal.masterAgentWorker.authorize, { grantId: s.grantId, jobId: s.jobId })).rejects.toThrow();
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).delivery.released).toBe(false);
});
it("does not spend another run's grant, enroll gated retries or overspend a tampered reservation", async () => {
  const s = await setup(); await s.execute(); s.enable(); const { grantId } = await s.authorizeGrant(); const jobId = (await s.view()).steps[0].jobId!;
  await s.t.run(ctx => ctx.db.patch(grantId, { capYocto: "1" }));
  await expect(s.t.mutation(internal.masterAgentWorker.authorize, { grantId, jobId })).rejects.toThrow();
  expect(await s.owner.query(api.payments.forJob, { jobId })).toBeNull(); // Nested transaction rolls back preparation too.
  expect(await s.t.run(ctx => ctx.db.query("masterReservations").collect())).toEqual([]);
  await s.t.run(ctx => ctx.db.patch(grantId, { capYocto: s.context.capYocto }));
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "true");
  await expect(s.t.mutation(internal.masterAgentWorker.authorize, { grantId, jobId })).rejects.toThrow("EXACT_HUMAN_APPROVAL");
});
it("keeps parent and child accounting inside one award and blocks broken allocation", async () => {
  const s = await admitted("clean-summary");
  const detail = await s.owner.query(api.jobs.detail, { id: s.jobId });
  const childId = detail.children[0]._id;
  await s.t.mutation(internal.masterAgentWorker.authorize, { grantId: s.grantId, jobId: childId });
  const rows = await s.t.run(ctx => ctx.db.query("masterReservations").collect());
  expect(rows).toHaveLength(2); expect(rows.reduce((sum, r) => sum + BigInt(r.amountYocto), 0n)).toBe(BigInt(detail.contracts[0].amountYocto));
  await s.t.run(async ctx => { const child = (await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", childId)).unique())!; await ctx.db.patch(child._id, { holdbackYocto: "1" }); });
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intent._id })).toBeNull();
});
it("cancels only unawarded work, prevents late model completion and preserves audit", async () => {
  const s = await setup(); await s.propose(); await s.accept();
  await s.owner.mutation(api.masterAgent.cancel, { runId: s.runId });
  expect((await s.view()).run.state).toBe("cancelled");
  for (const step of (await s.view()).steps) expect((await s.owner.query(api.jobs.detail, { id: step.jobId! })).job.state).toBe("cancelled");
  await expect(s.owner.mutation(api.masterAgent.beginPlanning, { runId: s.runId, revision: 1 })).rejects.toThrow();
});
it("clears unexecuted planner data and blocks another owner's removal", async () => {
  const s = await setup(); await s.propose();
  await expect(s.other.mutation(api.masterAgent.removeContent, { runId: s.runId, confirm: "REMOVE_PLANNER_AND_MISSION_CONTENT" })).rejects.toThrow("NOT_FOUND");
  await s.owner.mutation(api.masterAgent.removeContent, { runId: s.runId, confirm: "REMOVE_PLANNER_AND_MISSION_CONTENT" });
  const context = await s.owner.query(api.masterAgent.context, { runId: s.runId });
  expect(context.context.datasets).toEqual([]); expect(context.context.clarifications).toEqual([]);
  expect((await s.view()).run.planJson).toBeNull(); expect((await s.view()).run.state).toBe("content_removed");
  await expect(s.accept()).rejects.toThrow();
});
it("removes cancelled bundle copies atomically but preserves approved unpaid work", async () => {
  const s = await setup("multi-step"); await s.propose(); await s.accept();
  const steps = (await s.view()).steps;
  await expect(s.owner.mutation(api.retention.removeContent, { missionId: steps[0].missionId, confirm: "REMOVE_DATASET_AND_OUTPUTS" })).rejects.toThrow("planner");
  await s.owner.mutation(api.masterAgent.cancel, { runId: s.runId });
  await s.owner.mutation(api.masterAgent.removeContent, { runId: s.runId, confirm: "REMOVE_PLANNER_AND_MISSION_CONTENT" });
  for (const step of steps) expect((await s.owner.query(api.missions.get, { id: step.missionId })).inputCsv).toBe("");
  const t = await setup(); await t.execute();
  await expect(t.owner.mutation(api.masterAgent.removeContent, { runId: t.runId, confirm: "REMOVE_PLANNER_AND_MISSION_CONTENT" })).rejects.toThrow();
  expect((await t.owner.query(api.masterAgent.context, { runId: t.runId })).context.datasets[0].csv).toBe(t.context.datasets[0].csv);
});

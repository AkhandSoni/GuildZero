import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { testBackend, asUser } from "../helpers/backend";
const modules = import.meta.glob("../../convex/**/*.ts");
const NEAR = 10n ** 24n;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function setup() {
  vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet");
  vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify({ "stats-core": "worker.testnet" }));
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true");
  vi.stubEnv("NEAR_PRIVATE_KEY", "not-a-key-policy-test-never-signs");
  const t = testBackend(schema, modules);
  const [a, b, outsider] = await t.run(ctx => Promise.all(["a", "b", "outsider"].map(name => ctx.db.insert("users", { email: `${name}@example.com` }))));
  const alice = await asUser(t, a), bob = await asUser(t, b), unlisted = await asUser(t, outsider);
  function configure(owners = { [a]: (2n * NEAR).toString(), [b]: (2n * NEAR).toString() }, global = 4n * NEAR) {
    vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON", JSON.stringify(owners));
    vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO", global.toString());
  }
  configure();
  async function job(ownerId: Id<"users">, price = NEAR, approved = true, parentId?: Id<"jobs">) {
    return t.run(async ctx => {
      const missionId = await ctx.db.insert("missions", { ownerId, title: "Allowance policy fixture", serviceType: "csv_summary", inputCsv: "x\n1", options: { columns: ["x"] }, maxBudgetYocto: (10n * NEAR).toString(), acceptanceCriteria: "fixture", deadlineAt: Date.now() + 86400000, state: "active", createdAt: Date.now(), updatedAt: Date.now() });
      const jobId = await ctx.db.insert("jobs", { ownerId, missionId, ...(parentId ? { parentId } : {}), depth: parentId ? 1 : 0, serviceType: "csv_summary", inputCsv: "x\n1", options: { columns: ["x"] }, budgetYocto: (10n * NEAR).toString(), reservedYocto: approved ? price.toString() : "0", state: approved ? "approved" : "bidding", revisionCount: 0, createdAt: Date.now(), updatedAt: Date.now() });
      const bidId = await ctx.db.insert("bids", { jobId, agentId: "stats-core", priceYocto: price.toString(), minimumYocto: "1", etaMs: 1000, rationale: "Offline fixture", createdAt: Date.now() });
      if (approved) {
        await ctx.db.insert("contracts", { jobId, agentId: "stats-core", bidId, amountYocto: price.toString(), holdbackYocto: price.toString(), state: "completed", selectionReason: "Offline policy fixture, not executed work", createdAt: Date.now() });
        const deliverableId = await ctx.db.insert("deliverables", { jobId, attempt: 0, format: "json", content: "{}", createdAt: Date.now() });
        await ctx.db.insert("verifications", { jobId, deliverableId, verdict: "pass", checks: [], createdAt: Date.now() });
      }
      return { jobId, bidId };
    });
  }
  return { t, a, b, outsider, alice, bob, unlisted, configure, job };
}
it("requires an explicit valid owner allowlist and never grants a signup balance", async () => {
  const s = await setup();
  await expect(s.t.query(api.payments.allowance, {})).rejects.toThrow();
  expect(await s.unlisted.query(api.payments.allowance, {})).toEqual({ configured: false, code: "DEMO_OWNER_NOT_ALLOWLISTED" });
  vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON", "{}");
  expect((await s.alice.query(api.payments.allowance, {})).configured).toBe(false);
  for (const raw of ["", "{", "[]", JSON.stringify({ [s.a]: 1 }), JSON.stringify({ [s.a]: "1.5" })]) {
    vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON", raw);
    expect((await s.alice.query(api.payments.allowance, {})).configured).toBe(false);
  }
});
it("admits concurrent root awards atomically within the shared ceiling", async () => {
  const s = await setup();
  s.configure(undefined, NEAR);
  const [first, second] = await Promise.all([s.job(s.a, NEAR, false), s.job(s.b, NEAR, false)]);
  const results = await Promise.allSettled([first, second].map(j => s.t.mutation(internal.workflow.award, { bidId: j.bidId, selectionReason: "Allowance admission test" })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(await s.t.run(ctx => ctx.db.query("contracts").collect())).toHaveLength(1);
});
it("denies owner overcommitment and unlisted awards; cancellation of an unawarded job adds no debt", async () => {
  const s = await setup();
  s.configure({ [s.a]: NEAR.toString() });
  await s.job(s.a);
  const excess = await s.job(s.a, NEAR, false), unlisted = await s.job(s.outsider, NEAR, false);
  await expect(s.t.mutation(internal.workflow.award, { bidId: excess.bidId, selectionReason: "fixture" })).rejects.toThrow("DEMO_OWNER_ALLOWANCE_EXCEEDED");
  await expect(s.t.mutation(internal.workflow.award, { bidId: unlisted.bidId, selectionReason: "fixture" })).rejects.toThrow("DEMO_OWNER_NOT_ALLOWLISTED");
  await s.alice.mutation(api.jobs.cancel, { id: excess.jobId });
  expect(await s.alice.query(api.payments.allowance, {})).toMatchObject({ obligatedYocto: NEAR.toString() });
});
it("counts a subcontract as part of the existing award, and retains unpaid obligations after preparation failure", async () => {
  const s = await setup();
  const parent = await s.job(s.a), child = await s.job(s.a, NEAR / 4n, true, parent.jobId);
  await s.t.run(async ctx => {
    const contract = (await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", parent.jobId)).unique())!;
    await ctx.db.patch(contract._id, { holdbackYocto: (3n * NEAR / 4n).toString() });
  });
  const p = await s.alice.mutation(api.payments.prepare, { jobId: parent.jobId });
  const c = await s.alice.mutation(api.payments.prepare, { jobId: child.jobId });
  if (!p.ok || !c.ok) throw new Error("Fixture prepare failed");
  await s.t.run(async ctx => {
    await ctx.db.patch(p.intentId, { status: "FAILED", lastReason: "PROVEN_PRE_BROADCAST_FAILURE" });
    await ctx.db.patch(c.intentId, { status: "CONFIRMED" });
  });
  expect(await s.alice.query(api.payments.allowance, {})).toMatchObject({ obligatedYocto: NEAR.toString() });
  // Rejected parent releases only its unpaid remainder; paid child remains consumed.
  await s.t.run(async ctx => {
    const contract = (await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", parent.jobId)).unique())!;
    await ctx.db.patch(contract._id, { state: "failed" });
    await ctx.db.patch(parent.jobId, { state: "rejected" });
  });
  expect(await s.alice.query(api.payments.allowance, {})).toMatchObject({ obligatedYocto: (NEAR / 4n).toString() });
});
it("counts authorized, submitted, uncertain and confirmed consumption once and hides other owners", async () => {
  const s = await setup();
  const a = await s.job(s.a), b = await s.job(s.b);
  const p = await s.alice.mutation(api.payments.prepare, { jobId: a.jobId });
  await s.bob.mutation(api.payments.prepare, { jobId: b.jobId });
  if (!p.ok) throw new Error(p.code);
  for (const status of ["READY", "SUBMITTING", "CONFIRMING", "UNKNOWN_RECONCILE", "CONFIRMED"] as const) {
    await s.t.run(ctx => ctx.db.patch(p.intentId, { status, authorizedAt: Date.now() }));
    expect(await s.alice.query(api.payments.allowance, {})).toEqual({ configured: true, limitYocto: (2n * NEAR).toString(), obligatedYocto: NEAR.toString(), remainingYocto: NEAR.toString() });
  }
});
it("revalidates lowered limits and removed owner permission at authorization and signer claim", async () => {
  const s = await setup();
  const j = await s.job(s.a);
  const p = await s.alice.mutation(api.payments.prepare, { jobId: j.jobId });
  if (!p.ok) throw new Error(p.code);
  const args = { intentId: p.intentId, recipient: "worker.testnet", amountYocto: NEAR.toString() };
  s.configure({ [s.a]: "0" });
  expect(await s.alice.mutation(api.payments.authorize, args)).toEqual({ ok: false, code: "DEMO_OWNER_ALLOWANCE_EXCEEDED" });
  s.configure();
  expect(await s.alice.mutation(api.payments.authorize, args)).toEqual({ ok: true });
  s.configure({});
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: p.intentId })).toBeNull();
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
  expect(await s.alice.query(api.payments.forJob, { jobId: j.jobId })).toMatchObject({ lastReason: "DEMO_OWNER_NOT_ALLOWLISTED", status: "READY" });
});
it("handles concurrent owner authorizations and blocks all new signing after a shared limit reduction", async () => {
  const s = await setup();
  const jobs = await Promise.all([s.job(s.a), s.job(s.b)]);
  const callers = [s.alice, s.bob];
  const intents = await Promise.all(jobs.map((j, i) => callers[i].mutation(api.payments.prepare, { jobId: j.jobId })));
  const args = intents.map(p => {
    if (!p.ok) throw new Error(p.code);
    return { intentId: p.intentId, recipient: "worker.testnet", amountYocto: NEAR.toString() };
  });
  expect(await Promise.all(args.map((a, i) => callers[i].mutation(api.payments.authorize, a)))).toEqual([{ ok: true }, { ok: true }]);
  s.configure(undefined, NEAR);
  expect(await Promise.all(args.map(a => s.t.mutation(internal.paymentWorker.claim, { intentId: a.intentId })))).toEqual([null, null]);
  const records = await s.t.run(ctx => ctx.db.query("paymentIntents").collect());
  expect(records.every(p => p.lastReason === "DEMO_OPERATOR_ALLOWANCE_EXCEEDED" && p.authorizedAt === undefined)).toBe(true);
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("fails closed at authorization with missing policy and on excessive history", async () => {
  const s = await setup();
  const j = await s.job(s.a);
  const p = await s.alice.mutation(api.payments.prepare, { jobId: j.jobId });
  if (!p.ok) throw new Error(p.code);
  const args = { intentId: p.intentId, recipient: "worker.testnet", amountYocto: NEAR.toString() };
  vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO", "");
  expect(await s.alice.mutation(api.payments.authorize, args)).toEqual({ ok: false, code: "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED" });
  s.configure();
  await s.t.run(async ctx => {
    const source = (await ctx.db.get(j.jobId))!;
    const { _id, _creationTime, ...fields } = source;
    void _id; void _creationTime;
    for (let i = 0; i < 1000; i++) await ctx.db.insert("jobs", { ...fields, state: "cancelled", reservedYocto: "0" });
  });
  expect(await s.alice.mutation(api.payments.authorize, args)).toEqual({ ok: false, code: "DEMO_ACCOUNTING_CAPACITY_REACHED" });
  expect(await s.t.run(ctx => ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("retains an uncertain failed-parent transfer in addition to an unpaid child obligation", async () => {
  const s = await setup();
  const parent = await s.job(s.a), child = await s.job(s.a, NEAR / 4n, true, parent.jobId);
  await s.t.run(async ctx => {
    const contract = (await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", parent.jobId)).unique())!;
    await ctx.db.patch(contract._id, { holdbackYocto: (3n * NEAR / 4n).toString() });
  });
  const p = await s.alice.mutation(api.payments.prepare, { jobId: parent.jobId });
  if (!p.ok) throw new Error(p.code);
  await s.t.run(async ctx => {
    await ctx.db.patch(p.intentId, { status: "UNKNOWN_RECONCILE" });
    const contract = (await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", parent.jobId)).unique())!;
    await ctx.db.patch(contract._id, { state: "failed" });
  });
  expect(await s.alice.query(api.payments.allowance, {})).toMatchObject({ obligatedYocto: NEAR.toString() });
  expect(child.jobId).toBeTruthy();
});
it("never discounts known transfers when historical parent and child allocations overlap", async () => {
  const s = await setup();
  // Deliberately inconsistent historical split: parent holdback was never
  // reduced for this child. The real workflow prevents creating this shape.
  const parent = await s.job(s.a, NEAR / 2n), child = await s.job(s.a, NEAR / 2n, true, parent.jobId);
  const p = await s.alice.mutation(api.payments.prepare, { jobId: parent.jobId });
  const c = await s.alice.mutation(api.payments.prepare, { jobId: child.jobId });
  if (!p.ok || !c.ok) throw new Error("Fixture prepare failed");
  for (const status of ["READY", "SUBMITTING", "CONFIRMING", "UNKNOWN_RECONCILE", "CONFIRMED"] as const) {
    await s.t.run(async ctx => {
      await ctx.db.patch(p.intentId, { status, authorizedAt: Date.now() });
      await ctx.db.patch(c.intentId, { status, authorizedAt: Date.now() });
    });
    expect(await s.alice.query(api.payments.allowance, {})).toMatchObject({ obligatedYocto: NEAR.toString() });
  }
});

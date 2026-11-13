import { testBackend, asUser } from "../helpers/backend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { rankBids } from "../../lib/economy";
import { INITIAL_AGENTS } from "../../lib/agents";
const modules = import.meta.glob("../../convex/**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup(overrides: Record<string, unknown> = {}) {
  const t = testBackend(schema, modules);
  const [ownerId, otherId] = await t.run((ctx) => Promise.all([
    ctx.db.insert("users", { email: "automatic@example.com" }),
    ctx.db.insert("users", { email: "outsider@example.com" }),
  ]));
  const owner = await asUser(t, ownerId);
  const outsider = await asUser(t, otherId);
  const missionId = await owner.mutation(api.missions.create, {
    title: "Automatic marketplace", serviceType: "csv_summary",
    inputCsv: "product,units,price\n Bag , 3 , 12.5 \nNotebook,5,4",
    options: { columns: ["units", "price"] }, maxBudgetYocto: "1000000000000000000000000",
    acceptanceCriteria: "Review the computed results.", deadlineAt: Date.now() + 86400000,
    requiresHumanReview: false, ...overrides,
  });
  const jobId = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId });
  const drain = () => t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const detail = () => owner.query(api.jobs.detail, { id: jobId });
  return { t, owner, outsider, missionId, jobId, drain, detail };
}
it("automatically completes a scored competitive auction, negotiation and independently verified real summary exactly once", async () => {
  const s = await setup(); await s.drain();
  const d = await s.detail();
  expect(d.job.state).toBe("approved"); expect(d.job.workerError).toBeUndefined();
  expect(d.bids).toHaveLength(3); expect(d.negotiations).toHaveLength(6);
  expect(d.negotiations.every((n) => n.round <= 3)).toBe(true);
  expect(d.contracts).toHaveLength(1); expect(d.contracts[0].score?.total).toBeGreaterThan(0);
  expect(d.verifications[0].verdict).toBe("pass");
  expect(JSON.parse((await s.t.run(ctx => ctx.db.get(d.deliverables[0]._id)))!.content)).toMatchObject({ rowCount: 2, columns: [{ name: "units", sum: 8 }, { name: "price", sum: 16.5 }] });
  expect(d.deliverables[0]).not.toHaveProperty("verificationPayload");
  await s.t.mutation(internal.economyWorker.step, { jobId: s.jobId, version: 0 });
  expect((await s.detail()).deliverables).toHaveLength(1);
  expect(await s.t.run((ctx) => ctx.db.query("reputationEvents").collect())).toHaveLength(1);
  expect(await s.owner.query(api.payments.forJob, { jobId: s.jobId })).toBeNull();
  await expect(s.outsider.query(api.jobs.detail, { id: s.jobId })).rejects.toThrow("JOB_NOT_FOUND");
});
it("automatically hires one real cleaning subcontractor, consumes its approved output and conserves the award", async () => {
  const s = await setup({ cleanBeforeProcessing: true }); await s.drain();
  const parent = await s.detail();
  expect(parent.job.workerError).toBeUndefined(); expect(parent.job.state).toBe("approved");
  expect(parent.children).toHaveLength(1);
  const child = await s.owner.query(api.jobs.detail, { id: parent.children[0]._id });
  expect(child.job.state).toBe("approved"); expect(child.job.depth).toBe(1); expect(child.children).toEqual([]);
  expect(child.deliverables[0].content).toBeNull();
  expect((await s.t.run(ctx => ctx.db.get(child.deliverables[0]._id)))!.content).toBe("product,units,price\nBag,3,12.5\nNotebook,5,4");
  expect(parent.deliverables[0].dependencyDeliverableId).toBe(child.deliverables[0]._id);
  expect(BigInt(parent.contracts[0].holdbackYocto) + BigInt(child.contracts[0].amountYocto)).toBe(BigInt(parent.contracts[0].amountYocto));
  expect(BigInt(parent.job.reservedYocto)).toBeLessThanOrEqual(BigInt(parent.job.budgetYocto));
  expect(await s.t.run((ctx) => ctx.db.query("reputationEvents").collect())).toHaveLength(2);
});
it("leaves an unaffordable mission unawarded and a cancelled auction inert", async () => {
  const low = await setup({ maxBudgetYocto: "1" }); await low.drain();
  expect((await low.detail()).job.state).toBe("unawarded"); expect((await low.detail()).contracts).toEqual([]);
  const cancelled = await setup(); await cancelled.owner.mutation(api.jobs.cancel, { id: cancelled.jobId }); await cancelled.drain();
  expect((await cancelled.detail()).job.state).toBe("cancelled"); expect((await cancelled.detail()).bids).toEqual([]);
});
it("requires an owner decision on subjective acceptance criteria", async () => {
  const s = await setup({ requiresHumanReview: true }); await s.drain();
  expect((await s.detail()).job.state).toBe("disputed"); expect((await s.detail()).verifications[0].verdict).toBe("needs_human");
  await expect(s.outsider.mutation(api.jobs.resolveDispute, { id: s.jobId, decision: "approve", reason: "intrusion" })).rejects.toThrow("JOB_NOT_FOUND");
  await s.owner.mutation(api.jobs.resolveDispute, { id: s.jobId, decision: "approve", reason: "Reviewed the actual output" });
  expect((await s.detail()).job.state).toBe("approved");
  await expect(s.owner.mutation(api.jobs.resolveDispute, { id: s.jobId, decision: "approve", reason: "again" })).rejects.toThrow("NO_OPEN_DISPUTE");
});
it("handles an unexecutable dataset without inventing output or allowing approval", async () => {
  const s = await setup({ options: { columns: ["units"] } });
  // Historical already-started job from before numeric preflight. New launches
  // reject this input; the executor must still fail closed for existing work.
  await s.t.run(ctx => ctx.db.patch(s.jobId, { inputCsv: "units,price\nnot-a-number,4" }));
  await s.drain();
  expect((await s.detail()).job.state).toBe("disputed"); expect((await s.detail()).deliverables).toEqual([]);
  await expect(s.owner.mutation(api.jobs.resolveDispute, { id: s.jobId, decision: "approve", reason: "No output" })).rejects.toThrow("NO_DELIVERABLE_TO_APPROVE");
  await s.owner.mutation(api.jobs.resolveDispute, { id: s.jobId, decision: "reject", reason: "Correct the source" });
  expect((await s.detail()).job.state).toBe("rejected");
});
it("pauses atomically on invalid private configuration, enforces ownership and bounds retries", async () => {
  vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON", "invalid private configuration");
  const s = await setup(); await s.drain();
  expect((await s.detail()).job.workerError).toBe("WORKFLOW_PAUSED_RETRY_AVAILABLE"); expect((await s.detail()).bids).toEqual([]);
  expect(JSON.stringify((await s.detail()).events)).not.toContain("invalid private configuration");
  await expect(s.outsider.mutation(api.jobs.resume, { id: s.jobId })).rejects.toThrow("JOB_NOT_FOUND");
  for (let i = 0; i < 3; i++) { await s.owner.mutation(api.jobs.resume, { id: s.jobId }); await s.drain(); }
  expect((await s.detail()).job.state).toBe("unawarded");
  await expect(s.owner.mutation(api.jobs.resume, { id: s.jobId })).rejects.toThrow("WORKFLOW_NOT_RETRYABLE");
});
it("resumes the existing stage after configuration is corrected without duplicating work", async () => {
  vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON", "invalid"); const s = await setup(); await s.drain();
  vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON", "{}"); await s.owner.mutation(api.jobs.resume, { id: s.jobId }); await s.drain();
  expect((await s.detail()).job.state).toBe("approved"); expect((await s.detail()).bids).toHaveLength(3);
});
it("detects tampering in stored output, runs one real revision and records reputation once", async () => {
  const s = await setup();
  // Move the actual driver through bidding, award and submission without advancing timers.
  for (let version = 0; version < 3; version++) await s.t.mutation(internal.economyWorker.step, { jobId: s.jobId, version });
  let d = await s.detail(); expect(d.job.state).toBe("verifying");
  await s.t.run(async (ctx) => { const actual = JSON.parse((await ctx.db.get(d.deliverables[0]._id))!.content); actual.columns[0].sum = 999; await ctx.db.patch(d.deliverables[0]._id, { content: JSON.stringify(actual) }); });
  await s.t.mutation(internal.economyWorker.step, { jobId: s.jobId, version: 3 });
  expect((await s.detail()).job.state).toBe("revision"); await s.drain(); d = await s.detail();
  expect(d.job.state).toBe("approved"); expect(d.deliverables).toHaveLength(2);
  expect(d.verifications.map((v) => v.verdict)).toEqual(["fail", "pass"]);
  expect(await s.t.run((ctx) => ctx.db.query("reputationEvents").collect())).toHaveLength(1);
});
it("pending human decisions preserve obligations without exhausting execution capacity", async () => {
  const s = await setup({ requiresHumanReview: true }); await s.drain();
  const first = await s.detail(); expect(first.contracts[0].state).toBe("awaiting_review");
  expect(first.job.reservedYocto).toBe(first.contracts[0].amountYocto);
  await expect(s.owner.mutation(api.payments.prepare, { jobId: s.jobId })).resolves.toMatchObject({ ok: false, code: "WORK_NOT_APPROVED" });
  for (let i = 0; i < 5; i++) {
    const missionId = await s.owner.mutation(api.missions.create, { title: `Review backlog ${i}`, serviceType: "csv_summary", inputCsv: "units\n3\n5", options: { columns: ["units"] }, maxBudgetYocto: "1000000000000000000000000", acceptanceCriteria: "Owner review", requiresHumanReview: true, deadlineAt: Date.now() + 86400000 });
    const jobId = await s.owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId }); await s.drain();
    expect((await s.owner.query(api.jobs.detail, { id: jobId })).job.state).toBe("disputed");
  }
  // Legacy repair changes only execution state and remains idempotent.
  await s.t.run((ctx) => ctx.db.patch(first.contracts[0]._id, { state: "active" }));
  expect(await s.t.mutation(internal.maintenance.releaseLegacyReviewCapacity, {})).toEqual({ updated: 1 });
  expect(await s.t.mutation(internal.maintenance.releaseLegacyReviewCapacity, {})).toEqual({ updated: 0 });
  expect((await s.detail()).job.reservedYocto).toBe(first.job.reservedYocto);
});
it("uses earned outcomes in later auctions without changing fixed strategies", async () => {
  // Expensive private floors make the other two summary sellers decline the
  // first brief. Restore their normal floors for the later competitive auction.
  vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON", JSON.stringify({ "stats-core": "2000000000000000000000000", "analysis-careful": "2000000000000000000000000" }));
  const s = await setup(); await s.drain(); const first = await s.detail();
  expect(first.contracts[0].agentId).toBe("report-craft");
  vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON", "{}");
  const budget = "1000000000000000000000000000";
  const missionId = await s.owner.mutation(api.missions.create, { title: "Second performance-priced auction", serviceType: "csv_summary", inputCsv: "units\n3\n5", options: { columns: ["units"] }, maxBudgetYocto: budget, acceptanceCriteria: "Template", requiresHumanReview: false, deadlineAt: Date.now() + 86400000 });
  const jobId = await s.owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId }); await s.drain();
  const bids = await s.t.run((ctx) => ctx.db.query("bids").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
  expect(bids.find((b) => b.agentId === first.contracts[0].agentId)?.reputationBps).toBe(5100);
  expect(bids.filter((b) => b.agentId !== first.contracts[0].agentId).every((b) => b.reputationBps === 5000)).toBe(true);
  const second = await s.owner.query(api.jobs.detail, { id: jobId });
  expect(second.job.state).toBe("approved");
  expect(second.contracts[0].agentId).toBe("report-craft");
  const baseline = rankBids({ budgetYocto: budget, availableDurationMs: 86400000,
    offers: bids.map((bid) => ({ agentId: bid.agentId, bidId: bid._id, priceYocto: second.negotiations.find((n) => n.bidId === bid._id && n.action === "accept")!.priceYocto,
      minimumAcceptableYocto: bid.minimumYocto, estimatedCostYocto: bid.estimatedCostYocto!, etaMs: bid.etaMs,
      strategy: INITIAL_AGENTS.find((a) => a.id === bid.agentId)!.strategy!, explanation: "Counterfactual initial reputation" })),
    reputationBps: bids.map(() => 5000), capabilityMatchBps: bids.map(() => 10000) });
  expect(baseline.ok && baseline.value[0].offer.agentId).toBe("stats-core");
});

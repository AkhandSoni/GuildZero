import { testBackend, asUser } from "../helpers/backend";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => vi.useRealTimers());

it("still resumes a parent after human approval of a child with real output", async () => {
  vi.useFakeTimers();
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "child-review-audit@example.com" }));
  const owner = await asUser(t, ownerId);
  const missionId = await owner.mutation(api.missions.create, {
    title: "Approvable cleaning dependency", serviceType: "csv_summary", inputCsv: "product,units\n Bag ,3",
    options: { columns: ["units"] }, maxBudgetYocto: "1000000000000000000000000", cleanBeforeProcessing: true,
    requiresHumanReview: false, acceptanceCriteria: "Review cleaned data", deadlineAt: Date.now() + 86400000,
  });
  const id = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId });
  for (let version = 0; version < 3; version++) await t.mutation(internal.economyWorker.step, { jobId: id, version });
  const childId = (await owner.query(api.jobs.detail, { id })).children[0]._id;
  // Trusted fixture forces an otherwise automatic child into the existing review path.
  await t.run((ctx) => ctx.db.patch(childId, { requiresHumanReview: true }));
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const child = await owner.query(api.jobs.detail, { id: childId });
  expect(child.job.state).toBe("disputed");
  expect(child.deliverables).toHaveLength(1);
  expect((await owner.query(api.jobs.detail, { id })).job.state).toBe("working");
  await owner.mutation(api.jobs.resolveDispute, { id: childId, decision: "approve", reason: "Checked actual CSV" });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await owner.query(api.jobs.detail, { id })).job.state).toBe("approved");
});

it("releases parent execution capacity when a required child has no approvable output", async () => {
  vi.useFakeTimers();
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "dependency-audit@example.com" }));
  const owner = await asUser(t, ownerId);
  const missionId = await owner.mutation(api.missions.create, {
    title: "Unexecutable cleaning dependency", serviceType: "csv_summary",
    inputCsv: "product,units\n=unsafe,3", options: { columns: ["units"] },
    maxBudgetYocto: "1000000000000000000000000", cleanBeforeProcessing: true,
    requiresHumanReview: false, acceptanceCriteria: "Use approved cleaning output", deadlineAt: Date.now() + 86400000,
  });
  const id = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const parent = await owner.query(api.jobs.detail, { id });
  const child = await owner.query(api.jobs.detail, { id: parent.children[0]._id });
  expect(child.job.state).toBe("disputed");
  expect(child.deliverables).toEqual([]);
  expect(parent.job.state).toBe("disputed");
  expect(parent.contracts[0].state).toBe("awaiting_review");
  expect(parent.job.reservedYocto).toBe(parent.contracts[0].amountYocto);
  await expect(owner.mutation(api.jobs.resolveDispute, { id, decision: "approve", reason: "No child output" }))
    .rejects.toThrow("CHILD_WORK_INCOMPLETE");
  expect(await owner.mutation(api.payments.prepare, { jobId: id })).toMatchObject({ ok: false, code: "WORK_NOT_APPROVED" });
  await owner.mutation(api.jobs.resolveDispute, { id: child.job._id, decision: "reject", reason: "Unsafe export" });
  await owner.mutation(api.jobs.resolveDispute, { id, decision: "reject", reason: "Required dependency failed" });
  const final = await owner.query(api.jobs.detail, { id });
  expect(final.disputes).toHaveLength(1);
  expect(final.job.state).toBe("rejected");
});

it("persists BOM input and cancellation-safe statistics through the actual scheduled workflow", async () => {
  vi.useFakeTimers();
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "audit-regression@example.com" }));
  const owner = await asUser(t, ownerId);
  const inputCsv = '\ufeff"two\nlines",units\r\nfirst,1000000000000\r\nsecond,0.00001\r\nthird,-1000000000000\r\n';
  const missionId = await owner.mutation(api.missions.create, {
    title: "BOM and cancellation regression", serviceType: "csv_summary", inputCsv,
    options: { columns: ["units"] }, maxBudgetYocto: "1000000000000000000000000",
    acceptanceCriteria: "Preserve the nonzero contribution", requiresHumanReview: false,
    deadlineAt: Date.now() + 86400000,
  });
  expect((await owner.query(api.missions.get, { id: missionId })).inputCsv).toBe(inputCsv);
  const id = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const detail = await owner.query(api.jobs.detail, { id });
  expect(detail.job.state).toBe("approved");
  expect(detail.verifications).toHaveLength(1);
  expect(detail.verifications[0].verdict).toBe("pass");
  expect(JSON.parse((await t.run(ctx => ctx.db.get(detail.deliverables[0]._id)))!.content).columns[0].sum).toBeCloseTo(0.00001, 12);
  expect(await owner.query(api.payments.forJob, { jobId: id })).toBeNull();
});

it("denies anonymous callers at every public marketplace entry point", async () => {
  vi.useFakeTimers();
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "audit-owner@example.com" }));
  const owner = await asUser(t, ownerId);
  const input = {
    title: "Access control audit", serviceType: "csv_summary" as const, inputCsv: "units\n1",
    options: { columns: ["units"] }, maxBudgetYocto: "1000000000000000000000000",
    acceptanceCriteria: "Template", deadlineAt: Date.now() + 86400000,
  };
  const missionId = await owner.mutation(api.missions.create, input);
  const jobId = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId });
  // Only obtain a valid ID. No settlement action is scheduled or executed.
  const intentId = await t.run(async (ctx) => {
    const bidId = await ctx.db.insert("bids", { jobId, agentId: "stats-core",
      priceYocto: "1", minimumYocto: "1", etaMs: 1, rationale: "Access test fixture", createdAt: Date.now() });
    const contractId = await ctx.db.insert("contracts", { jobId, bidId, agentId: "stats-core",
      amountYocto: "1", holdbackYocto: "1", state: "active", selectionReason: "Access test fixture", createdAt: Date.now() });
    return ctx.db.insert("paymentIntents", {
      ownerId, jobId, contractId,
      sender: "operator.testnet", recipient: "worker.testnet", amountYocto: "1",
      network: "testnet", status: "READY", createdAt: Date.now(),
    });
  });
  const attempts = [
    () => t.query(api.missions.list, { paginationOpts: { cursor: null, numItems: 20 } }),
    () => t.query(api.missions.get, { id: missionId }),
    () => t.mutation(api.missions.create, input),
    () => t.mutation(api.missions.update, { id: missionId, ...input }),
    () => t.mutation(api.missions.remove, { id: missionId }),
    () => t.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId }),
    () => t.mutation(api.jobs.resume, { id: jobId }),
    () => t.query(api.jobs.detail, { id: jobId }),
    () => t.query(api.jobs.forMission, { missionId }),
    () => t.mutation(api.jobs.cancel, { id: jobId }),
    () => t.mutation(api.jobs.resolveDispute, { id: jobId, decision: "approve", reason: "Denied" }),
    () => t.query(api.marketViews.overview, {}),
    () => t.query(api.marketViews.agent, { agentId: "stats-core" }),
    () => t.mutation(api.demo.seed, {}),
    () => t.mutation(api.demo.resetUnused, {}),
    () => t.mutation(api.security.run, { jobId, scenario: "reputation" }),
    () => t.query(api.security.history, {}),
    () => t.mutation(api.payments.prepare, { jobId }),
    () => t.mutation(api.payments.authorize, { intentId, recipient: "worker.testnet", amountYocto: "1" }),
    () => t.query(api.payments.forJob, { jobId }),
    () => t.mutation(api.payments.reconcile, { intentId }),
    () => t.query(api.payments.status, {}),
  ];
  for (const attempt of attempts) await expect(attempt()).rejects.toThrow("UNAUTHENTICATED");
  await owner.mutation(api.jobs.cancel, { id: jobId });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
});

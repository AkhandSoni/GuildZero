import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = testBackend(schema, modules);
  const ownerId = await t.run(ctx => ctx.db.insert("users", { email: "strict-input@example.com" }));
  const owner = await asUser(t, ownerId);
  const brief = { title: "Strict input fixture", serviceType: "csv_summary" as const, inputCsv: 'price,units\n"$1,234.50",3\n"1234,50",-2', options: { columns: ["price", "units"] }, maxBudgetYocto: "1000000000000000000000000", acceptanceCriteria: "Column sums only", deadlineAt: Date.now() + 86400000 };
  return { t, owner, ownerId, brief };
}
it("keeps an invalid draft editable but blocks direct launch before any job, award or payment", async () => {
  const { t, owner, brief } = await setup();
  const id = await owner.mutation(api.missions.create, brief);
  await expect(owner.mutation(api.jobs.start, { missionId: id, allowUnfundedPreview: true })).rejects.toThrow(/price.*CSV records 2, 3/);
  expect((await owner.query(api.missions.get, { id })).inputCsv).toBe(brief.inputCsv);
  expect((await owner.query(api.missions.get, { id })).state).toBe("draft");
  expect(await owner.query(api.jobs.forMission, { missionId: id })).toEqual([]);
  expect(await t.run(async ctx => [await ctx.db.query("contracts").collect(), await ctx.db.query("paymentIntents").collect(), await ctx.db.query("economyEvents").collect()])).toEqual([[], [], []]);
  await owner.mutation(api.missions.update, { id, ...brief, options: { columns: ["units"] } });
  const jobId = await owner.mutation(api.jobs.start, { missionId: id, allowUnfundedPreview: true });
  expect((await owner.query(api.jobs.detail, { id: jobId })).job.inputCsv).toBe(brief.inputCsv);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  // The trusted backend retains actual computed values; public owner delivery
  // remains metadata-only until separately authorized matching settlement.
  const stored = await t.run(ctx => ctx.db.query("deliverables").withIndex("by_job", q => q.eq("jobId", jobId)).unique());
  expect(JSON.parse(stored!.content)).toMatchObject({ columns: [{ name: "units", sum: 1, mean: 0.5 }] });
  const publicResult = await owner.query(api.jobs.detail, { id: jobId });
  expect(publicResult.delivery.released).toBe(false);
  expect(publicResult.deliverables[0].content).toBeNull();
  expect(publicResult.deliverables[0].preview.columns).toEqual(["units"]);

});
it("revalidates historical drafts, with cleaning enabled unable to bypass numeric preflight", async () => {
  const { t, owner, ownerId, brief } = await setup();
  const id = await t.run(ctx => ctx.db.insert("missions", { ...brief, inputCsv: 'price\n=PRIVATE_FORMULA()', options: { columns: ["price"] }, cleanBeforeProcessing: true, ownerId, state: "draft", createdAt: Date.now(), updatedAt: Date.now() }));
  await expect(owner.mutation(api.jobs.start, { missionId: id, allowUnfundedPreview: true })).rejects.toThrow("UNSAFE_CSV_CELL");
  await expect(t.mutation(api.jobs.start, { missionId: id, allowUnfundedPreview: true })).rejects.toThrow();
  expect(await owner.query(api.jobs.forMission, { missionId: id })).toEqual([]);
  const saved = await owner.query(api.missions.get, { id });
  expect(saved.inputCsv).toBe('price\n=PRIVATE_FORMULA()');
});
it("normalization remains available for quoted locale text without interpreting or changing unselected values", async () => {
  const { owner, brief } = await setup();
  const id = await owner.mutation(api.missions.create, { ...brief, serviceType: "csv_normalize", options: { columns: ["price"], caseMode: "preserve" } });
  const jobId = await owner.mutation(api.jobs.start, { missionId: id, allowUnfundedPreview: true });
  expect((await owner.query(api.jobs.detail, { id: jobId })).job.inputCsv).toBe(brief.inputCsv);
});

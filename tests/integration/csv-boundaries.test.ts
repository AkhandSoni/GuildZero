import { testBackend, asUser } from "../helpers/backend";
import { expect, it } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { runService } from "../../lib/economy";
const modules = import.meta.glob("../../convex/**/*.ts");
async function setup() {
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "csv-boundary@example.com" }));
  const owner = await asUser(t, ownerId);
  const input = { title: "CSV boundary", serviceType: "csv_summary" as const,
    inputCsv: "a,b\n1,2", options: { columns: ["a"] }, maxBudgetYocto: "10000000000000000000000000",
    deadlineAt: Date.now() + 86400000, acceptanceCriteria: "Summary" };
  return { t, owner, ownerId, input };
}

it("accepts a quoted empty one-column record through create, edit, launch and execution", async () => {
  const { owner, input } = await setup();
  const id = await owner.mutation(api.missions.create, { ...input, inputCsv: 'a\n""' });
  await owner.mutation(api.missions.update, { id, ...input, inputCsv: 'a\n""\n' });
  const jobId = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId: id });
  const { job } = await owner.query(api.jobs.detail, { id: jobId });
  expect(runService({ serviceType: "csv_summary", inputCsv: job.inputCsv, options: { columns: job.options.columns } }))
    .toMatchObject({ ok: true, value: { rowCount: 1, columns: [{ count: 0, missing: 1 }] } });
});

it.each([
  ["501 real records", `a,b\n${[...Array(500).fill("1,2"), ","].join("\n")}`],
  ["wrong-width blank", "a,b\n1,2\n\n3,4"],
  ["raw overlong header", `a, ${"b".repeat(100)}\n1,2`],
  ["CRLF then LF", "a,b\r\n1,2\r\n3,4\n"],
  ["LF then CR", "a,b\n1,2\n3,4\r"],
])("rejects %s consistently at create, edit, launch and subcontract validation", async (_, inputCsv) => {
  const { t, owner, ownerId, input } = await setup();
  const bad = { ...input, inputCsv };
  await expect(owner.mutation(api.missions.create, bad)).rejects.toThrow();
  const id = await owner.mutation(api.missions.create, input);
  await expect(owner.mutation(api.missions.update, { id, ...bad })).rejects.toThrow();
  expect((await owner.query(api.missions.get, { id })).inputCsv).toBe(input.inputCsv);
  // A retained legacy draft cannot bypass the new validator at launch.
  const legacyId = await t.run((ctx) => ctx.db.insert("missions", {
    ...bad, ownerId, state: "draft", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  await expect(owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId: legacyId })).rejects.toThrow("INVALID_OR_EXPIRED_MISSION");
  expect(await owner.query(api.jobs.forMission, { missionId: legacyId })).toEqual([]);
  expect(runService({ serviceType: "csv_summary", inputCsv, options: { columns: ["a"] } })).toMatchObject({ ok: false, code: "INVALID_CSV" });
  // Simulate retained pre-validation parent data, not an executed auction.
  const jobId = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId: id });
  const bidId = await t.mutation(internal.workflow.recordBid, {
    jobId, agentId: "stats-core", priceYocto: "1000000000000000000000000",
    minimumYocto: "500000000000000000000000", etaMs: 1000, rationale: "Trusted boundary fixture",
  });
  await t.mutation(internal.workflow.award, { bidId, selectionReason: "Trusted boundary fixture" });
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { inputCsv });
    await ctx.db.patch(jobId, { inputCsv });
  });
  await expect(t.mutation(internal.workflow.subcontract, {
    parentId: jobId, budgetYocto: "100000000000000000000000", options: { columns: ["a"], caseMode: "preserve" },
  })).rejects.toThrow("INVALID_SUBCONTRACT_INPUT");
});

it("accepts exactly 500 records including the final empty record", async () => {
  const { owner, input } = await setup();
  const inputCsv = `a,b\r\n${[...Array(499).fill("1,2"), ","].join("\r\n")}\r\n`;
  const id = await owner.mutation(api.missions.create, { ...input, inputCsv });
  await owner.mutation(api.missions.update, { id, ...input, inputCsv });
  const jobId = await owner.mutation(api.jobs.start, { allowUnfundedPreview: true,  missionId: id });
  const { job } = await owner.query(api.jobs.detail, { id: jobId });
  expect(runService({ serviceType: "csv_summary", inputCsv: job.inputCsv, options: { columns: ["a"] } }))
    .toMatchObject({ ok: true, value: { rowCount: 500, columns: [{ count: 499, missing: 1, sum: 499 }] } });
});

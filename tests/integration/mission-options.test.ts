import { testBackend, asUser } from "../helpers/backend";
import { expect, it } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
async function setup() {
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "options@example.com" }));
  const owner = await asUser(t, ownerId);
  const input = { title: "Migration fixture", serviceType: "csv_normalize" as const,
    inputCsv: " product ,units\n Bag ,3\nBook,5", maxBudgetYocto: "9007199254740993",
    deadlineAt: Date.now() + 86400000, acceptanceCriteria: "Trim the explicitly selected column." };
  return { t, owner, ownerId, input };
}
it("keeps old drafts editable but requires saved options even if supplied at launch", async () => {
  const { t, owner, ownerId, input } = await setup();
  // Genuine pre-migration row: no defaults or invented column choices.
  const id = await t.run((ctx) => ctx.db.insert("missions", {
    ...input, ownerId, state: "draft", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const options = { columns: [" product "], caseMode: "lowercase" as const };
  await expect(owner.mutation(api.jobs.start, { missionId: id, options })).rejects.toThrow("OPTIONS_REQUIRED");
  await owner.mutation(api.missions.update, { id, ...input, title: "Still editable" });
  expect((await owner.query(api.missions.get, { id })).options).toBeUndefined();
  expect(await owner.query(api.jobs.forMission, { missionId: id })).toEqual([]);
  await owner.mutation(api.missions.update, { id, ...input, options });
  const jobId = await owner.mutation(api.jobs.start, { missionId: id });
  const { job } = await owner.query(api.jobs.detail, { id: jobId });
  expect(job.options).toEqual(options);
  expect(job.inputCsv).toBe(input.inputCsv);
  expect(job.budgetYocto).toBe(input.maxBudgetYocto);
  expect(await owner.mutation(api.jobs.start, { missionId: id })).toBe(jobId);
  await expect(owner.mutation(api.missions.update, { id, ...input, options })).rejects.toThrow("MISSION_ALREADY_STARTED");
});
it("validates columns and template options at create and edit, preserving prior data on failure", async () => {
  const { owner, input } = await setup();
  const options = { columns: ["units"] };
  const summary = { ...input, serviceType: "csv_summary" as const, options };
  const id = await owner.mutation(api.missions.create, summary);
  for (const invalid of [{ columns: ["units", "units"] }, { columns: [" product"] }, { columns: [] }, { columns: ["units"], caseMode: "lowercase" as const }]) {
    await expect(owner.mutation(api.missions.create, { ...summary, options: invalid })).rejects.toThrow(/INVALID_(COLUMNS|OPTIONS)/);
    await expect(owner.mutation(api.missions.update, { id, ...summary, options: invalid })).rejects.toThrow(/INVALID_(COLUMNS|OPTIONS)/);
    expect((await owner.query(api.missions.get, { id })).options).toEqual(options);
  }
  await expect(owner.mutation(api.jobs.start, { missionId: id, options: { columns: [" product "] } }))
    .rejects.toThrow("START_OPTIONS_CHANGED");
  expect((await owner.query(api.missions.get, { id })).state).toBe("draft");
  expect(await owner.query(api.jobs.forMission, { missionId: id })).toEqual([]);
  await owner.mutation(api.missions.update, { id, ...summary, options: { columns: [" product "] } });
  expect((await owner.query(api.missions.get, { id })).options).toEqual({ columns: [" product "] });
});
it("clears omitted options when an older API edits a draft instead of preserving stale columns", async () => {
  const { owner, input } = await setup();
  const id = await owner.mutation(api.missions.create, { ...input, options: { columns: ["units"], caseMode: "preserve" } });
  await owner.mutation(api.missions.update, { id, ...input, inputCsv: "other\nx" });
  expect((await owner.query(api.missions.get, { id })).options).toBeUndefined();
  await expect(owner.mutation(api.jobs.start, { missionId: id })).rejects.toThrow("OPTIONS_REQUIRED");
});

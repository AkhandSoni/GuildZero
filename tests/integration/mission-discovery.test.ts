import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = testBackend(schema, modules);
  const [a, b] = await t.run(async (ctx) => Promise.all([ctx.db.insert("users", { email: "browse-a@example.com" }), ctx.db.insert("users", { email: "browse-b@example.com" })]));
  return { t, a, b, alice: await asUser(t,a), bob: await asUser(t,b) };
}
function brief(title: string) { return { title, serviceType: "csv_summary" as const, inputCsv: "units\n2\n3", options: { columns: ["units"] }, maxBudgetYocto: "1000000000000000000000000", acceptanceCriteria: "Use template", requiresHumanReview: false, deadlineAt: Date.now()+2*86400000 }; }
const page = { numItems: 2, cursor: null };
it("searches older private titles beyond the first page, with prefix matching and owner isolation", async () => {
  const s = await setup();
  const old = await s.alice.mutation(api.missions.create, brief("Weekly orchard sales"));
  await s.bob.mutation(api.missions.create, brief("Weekly orchard sales"));
  for (let i=0;i<24;i++) await s.alice.mutation(api.missions.create, brief(`Recent shipment ${i}`));
  const found = await s.alice.query(api.missions.list, { search: "Orch", paginationOpts: page });
  expect(found.page.map((m) => m._id)).toEqual([old]);
  expect((await s.bob.query(api.missions.list, { search: "shipment", paginationOpts: page })).page).toEqual([]);
});
it("combines service and state filters, with or without a title search", async () => {
  const s = await setup();
  const id = await s.alice.mutation(api.missions.create, brief("Sales summary"));
  await s.alice.mutation(api.missions.create, { ...brief("Sales normalization"), serviceType: "csv_normalize", options: { columns: ["units"], caseMode: "preserve" } });
  await s.t.run((ctx) => ctx.db.patch(id, { state: "active" }));
  for (const search of [undefined,"sales"]) {
    const found = await s.alice.query(api.missions.list, { search, state: "active", serviceType: "csv_summary", paginationOpts: page });
    expect(found.page.map((m) => m._id)).toEqual([id]);
    expect((await s.alice.query(api.missions.list, { search, state: "draft", serviceType: "csv_summary", paginationOpts: page })).page).toEqual([]);
  }
});
it("paginates matching titles without leaking other owners' matching briefs", async () => {
  const s=await setup();
  for(let i=0;i<5;i++) await s.alice.mutation(api.missions.create,brief(`Monthly sales ${i}`));
  await s.bob.mutation(api.missions.create,brief("Monthly sales private"));
  const first=await s.alice.query(api.missions.list,{search:"monthly",paginationOpts:page});
  const second=await s.alice.query(api.missions.list,{search:"monthly",paginationOpts:{numItems:2,cursor:first.continueCursor}});
  expect(first.page).toHaveLength(2); expect(second.page).toHaveLength(2);
  expect(new Set([...first.page,...second.page].map((m)=>m._id)).size).toBe(4);
  expect([...first.page,...second.page].every((m)=>m.ownerId===s.a)).toBe(true);
});
it("denies anonymous discovery/copy and copying another owner's mission", async () => {
  const s=await setup();const id=await s.alice.mutation(api.missions.create,brief("Private source"));
  await expect(s.t.query(api.missions.list,{search:"private",paginationOpts:page})).rejects.toThrow("UNAUTHENTICATED");
  await expect(s.t.mutation(api.missions.duplicate,{id})).rejects.toThrow("UNAUTHENTICATED");
  await expect(s.bob.mutation(api.missions.duplicate,{id})).rejects.toThrow("MISSION_NOT_FOUND");
});
it("copies completed owned work as a fresh draft without execution records or payment authority", async () => {
  vi.useFakeTimers();const s=await setup();
  const id=await s.alice.mutation(api.missions.create,brief("Original sales"));
  const jobId=await s.alice.mutation(api.jobs.start,{missionId:id});
  await s.t.finishAllScheduledFunctions(()=>vi.runAllTimers());
  const before=await s.alice.query(api.jobs.detail,{id:jobId});expect(before.job.state).toBe("approved");
  const copyId=await s.alice.mutation(api.missions.duplicate,{id});
  const copy=await s.alice.query(api.missions.get,{id:copyId});
  expect(copy).toMatchObject({title:"Copy of Original sales",ownerId:s.a,state:"draft",inputCsv:"units\n2\n3",options:{columns:["units"]}});
  expect(copy.demo).toBeUndefined();expect(copy.deadlineAt).toBe(copy.createdAt+86400000);
  expect(await s.alice.query(api.jobs.forMission,{missionId:copyId})).toEqual([]);
  expect(await s.t.run((ctx)=>ctx.db.query("paymentIntents").collect())).toEqual([]);
  expect((await s.alice.query(api.jobs.detail,{id:jobId})).contracts).toEqual(before.contracts);
});
it("refreshes expired deadlines and keeps copied titles within the existing cap", async () => {
  const s=await setup();const id=await s.alice.mutation(api.missions.create,brief("x".repeat(100)));
  await s.t.run((ctx)=>ctx.db.patch(id,{deadlineAt:Date.now()-1}));
  const copyId=await s.alice.mutation(api.missions.duplicate,{id});
  const copy=await s.alice.query(api.missions.get,{id:copyId});
  expect(copy.title).toHaveLength(100);expect(copy.deadlineAt).toBeGreaterThan(Date.now());
});

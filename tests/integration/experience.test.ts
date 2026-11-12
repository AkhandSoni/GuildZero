import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  const [a, b] = await t.run((ctx) =>
    Promise.all([
      ctx.db.insert("users", { email: "a@example.com" }),
      ctx.db.insert("users", { email: "b@example.com" }),
    ]),
  );
  return {
    t,
    a,
    b,
    alice: t.withIdentity({ subject: `${a}|s` }),
    bob: t.withIdentity({ subject: `${b}|s` }),
  };
}
it("requires authentication for economy, profiles, samples and security history", async () => {
  const s = await setup();
  await expect(s.t.query(api.marketViews.overview, {})).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(
    s.t.query(api.marketViews.agent, { agentId: "stats-core" }),
  ).rejects.toThrow("UNAUTHENTICATED");
  await expect(s.t.mutation(api.demo.seed, {})).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(s.t.mutation(api.demo.resetUnused, {})).rejects.toThrow(
    "UNAUTHENTICATED",
  );
  await expect(s.t.query(api.security.history, {})).rejects.toThrow(
    "UNAUTHENTICATED",
  );
});
it("seeds samples idempotently and scopes reset to the caller's unused samples", async () => {
  const s = await setup();
  const seeded = await s.alice.mutation(api.demo.seed, {});
  expect(await s.alice.mutation(api.demo.seed, {})).toEqual(seeded);
  const other = await s.bob.mutation(api.demo.seed, {});
  expect(await s.alice.mutation(api.demo.resetUnused, {})).toEqual({
    removed: 2,
  });
  expect(
    (
      await s.bob.query(api.missions.list, {
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page
      .map((m) => m._id)
      .sort(),
  ).toEqual([...other.missionIds].sort());
});
it("keeps graph data, agent contract history and events private between owners", async () => {
  const s = await setup();
  const sample = await s.alice.mutation(api.demo.seed, {});
  const jobId = await s.alice.mutation(api.jobs.start, {
    missionId: sample.missionIds[1],
    options: { columns: ["units"] },
  });
  const bidId = await s.t.mutation(internal.workflow.recordBid, {
    jobId,
    agentId: "stats-core",
    priceYocto: "500000000000000000000000",
    minimumYocto: "200000000000000000000000",
    etaMs: 100,
    rationale: "Explicit persistence fixture",
  });
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "Explicit test input, not real scoring",
  });
  const own = await s.alice.query(api.marketViews.overview, {}),
    other = await s.bob.query(api.marketViews.overview, {});
  expect(own.jobs).toHaveLength(1);
  expect(own.bids).toHaveLength(1);
  expect(own.events.length).toBeGreaterThan(0);
  expect(other.jobs).toEqual([]);
  expect(other.bids).toEqual([]);
  expect(other.events).toEqual([]);
  expect(
    (await s.alice.query(api.marketViews.agent, { agentId: "stats-core" }))
      ?.contracts,
  ).toHaveLength(1);
  expect(
    (await s.bob.query(api.marketViews.agent, { agentId: "stats-core" }))
      ?.contracts,
  ).toEqual([]);
});
it("reset preserves active sample missions, job history and uncertain payment records", async () => {
  const s = await setup();
  const samples = await s.alice.mutation(api.demo.seed, {});
  const jobId = await s.alice.mutation(api.jobs.start, {
    missionId: samples.missionIds[1],
    options: { columns: ["units"] },
  });
  const bidId = await s.t.mutation(internal.workflow.recordBid, {
    jobId,
    agentId: "stats-core",
    priceYocto: "500000000000000000000000",
    minimumYocto: "200000000000000000000000",
    etaMs: 100,
    rationale: "test",
  });
  const contractId = await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "test",
  });
  const intentId = await s.t.run((ctx) =>
    ctx.db.insert("paymentIntents", {
      ownerId: s.a,
      jobId,
      contractId,
      sender: "operator.testnet",
      recipient: "worker.testnet",
      amountYocto: "500000000000000000000000",
      network: "testnet",
      status: "UNKNOWN_RECONCILE",
      createdAt: Date.now(),
    }),
  );
  expect(await s.alice.mutation(api.demo.resetUnused, {})).toEqual({
    removed: 1,
  });
  expect((await s.alice.query(api.jobs.detail, { id: jobId })).job._id).toBe(
    jobId,
  );
  expect(
    (await s.alice.query(api.missions.get, { id: samples.missionIds[1] }))
      .state,
  ).toBe("active");
  expect((await s.t.run((ctx) => ctx.db.get(intentId)))?.status).toBe(
    "UNKNOWN_RECONCILE",
  );
});

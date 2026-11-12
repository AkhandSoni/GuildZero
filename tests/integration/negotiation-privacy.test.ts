import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
const modules = import.meta.glob("../../convex/**/*.ts");
const privateFloor = "400000000000000000000001",
  diagnostic = "PRIVATE_COST_DIAGNOSTIC_ONLY";
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "buyer@example.com" }),
  );
  const buyer = t.withIdentity({ subject: `${ownerId}|session` });
  const missionId = await buyer.mutation(api.missions.create, {
    title: "Pricing privacy test",
    serviceType: "csv_summary",
    options: { columns: ["x"] },
    inputCsv: "x\n1",
    maxBudgetYocto: "1000000000000000000000000",
    acceptanceCriteria: "Fixture",
    deadlineAt: Date.now() + 86400000,
  });
  const jobId = await buyer.mutation(api.jobs.start, {
    missionId,
    options: { columns: ["x"] },
  });
  const bidId = await t.mutation(internal.workflow.recordBid, {
    jobId,
    agentId: "stats-core",
    priceYocto: "500000000000000000000000",
    minimumYocto: privateFloor,
    etaMs: 100,
    rationale: `${diagnostic}: ${privateFloor}`,
  });
  return { t, buyer, ownerId, missionId, jobId, bidId };
}
it("omits seller limits and diagnostic text from every buyer-facing pricing/history view", async () => {
  const s = await setup();
  await s.t.mutation(internal.workflow.negotiate, {
    bidId: s.bidId,
    actorRole: "buyer",
    round: 2,
    action: "accept",
    priceYocto: "500000000000000000000000",
    explanation: `${diagnostic} ${privateFloor}`,
  });
  await s.t.mutation(internal.workflow.award, {
    bidId: s.bidId,
    selectionReason: `${diagnostic} ${privateFloor}`,
  });
  const detail = await s.buyer.query(api.jobs.detail, { id: s.jobId }),
    overview = await s.buyer.query(api.marketViews.overview, {}),
    agent = await s.buyer.query(api.marketViews.agent, {
      agentId: "stats-core",
    });
  for (const value of [detail, overview, agent]) {
    const json = JSON.stringify(value);
    expect(json).not.toContain("minimumYocto");
    expect(json).not.toContain("reservePriceYocto");
    expect(json).not.toContain(privateFloor);
    expect(json).not.toContain(diagnostic);
  }
  expect(detail.bids[0].priceYocto).toBe("500000000000000000000000");
  const internalView = await s.t.query(internal.workflow.pricingContext, {
    jobId: s.jobId,
  });
  expect(internalView.bids[0].minimumYocto).toBe(privateFloor);
  expect(internalView.bids[0].rationale).toContain(diagnostic);
  for (const publicProfile of PUBLIC_AGENTS)
    expect(Object.keys(publicProfile)).not.toContain("reservePriceYocto");
});
it("derives buyer/seller identities and rejects wrong roles or acceptance of a different price", async () => {
  const s = await setup();
  const first = {
    bidId: s.bidId,
    actorRole: "buyer" as const,
    round: 2,
    action: "counter" as const,
    priceYocto: "450000000000000000000000",
    explanation: "Buyer proposal",
  };
  await expect(
    s.t.mutation(internal.workflow.negotiate, {
      ...first,
      actorRole: "seller",
    }),
  ).rejects.toThrow("NEGOTIATION_ROLE_MISMATCH");
  await s.t.mutation(internal.workflow.negotiate, first);
  await expect(
    s.t.mutation(internal.workflow.negotiate, {
      ...first,
      round: 3,
      actorRole: "seller",
      action: "accept",
      priceYocto: "460000000000000000000000",
    }),
  ).rejects.toThrow("REFERENCED_OFFER_PRICE_MISMATCH");
  await s.t.mutation(internal.workflow.negotiate, {
    ...first,
    round: 3,
    actorRole: "seller",
    action: "accept",
  });
  const transcript = (await s.buyer.query(api.jobs.detail, { id: s.jobId }))
    .negotiations;
  expect(transcript.map((n) => [n.actorRole, n.actorId])).toEqual([
    ["buyer", s.ownerId],
    ["seller", "stats-core"],
  ]);
  await s.t.mutation(internal.workflow.award, {
    bidId: s.bidId,
    selectionReason: "Accepted exact offer",
  });
  expect(
    (await s.buyer.query(api.jobs.detail, { id: s.jobId })).job.reservedYocto,
  ).toBe(first.priceYocto);
});
it("allows a buyer proposal below a hidden floor while refusing seller acceptance below it", async () => {
  const s = await setup();
  const proposal = {
    bidId: s.bidId,
    actorRole: "buyer" as const,
    round: 2,
    action: "counter" as const,
    priceYocto: "1",
    explanation: "Buyer knows its cap, not the seller's minimum",
  };
  await s.t.mutation(internal.workflow.negotiate, proposal);
  await expect(
    s.t.mutation(internal.workflow.negotiate, {
      ...proposal,
      round: 3,
      actorRole: "seller",
      action: "accept",
    }),
  ).rejects.toThrow("OFFER_OUT_OF_BOUNDS");
  await s.t.mutation(internal.workflow.negotiate, {
    ...proposal,
    round: 3,
    actorRole: "seller",
    action: "reject",
  });
  await expect(
    s.t.mutation(internal.workflow.award, {
      bidId: s.bidId,
      selectionReason: "must not award",
    }),
  ).rejects.toThrow("OFFER_NOT_ACCEPTED");
});
it("does not invent identities for legacy transcripts and blocks stale legacy authorization", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.insert("negotiations", {
      jobId: s.jobId,
      bidId: s.bidId,
      round: 2,
      action: "counter",
      priceYocto: "450000000000000000000000",
      explanation: diagnostic,
    }),
  );
  const legacy = (await s.buyer.query(api.jobs.detail, { id: s.jobId }))
    .negotiations[0];
  expect(legacy).toMatchObject({
    legacy: true,
    actorRole: null,
    actorId: null,
  });
  expect(JSON.stringify(legacy)).not.toContain(diagnostic);
  await expect(
    s.t.mutation(internal.workflow.negotiate, {
      bidId: s.bidId,
      actorRole: "seller",
      round: 3,
      action: "accept",
      priceYocto: "450000000000000000000000",
      explanation: "test",
    }),
  ).rejects.toThrow("LEGACY_NEGOTIATION_REASSESSMENT_REQUIRED");
  await expect(
    s.t.mutation(internal.workflow.award, {
      bidId: s.bidId,
      selectionReason: "test",
    }),
  ).rejects.toThrow("LEGACY_NEGOTIATION_REASSESSMENT_REQUIRED");
});
it("loads private configured floors only in worker context and rechecks them before award", async () => {
  const s = await setup();
  const override = "600000000000000000000001";
  vi.stubEnv(
    "AGENT_PRIVATE_FLOORS_JSON",
    JSON.stringify({ "stats-core": override }),
  );
  const worker = await s.t.query(internal.workflow.pricingContext, {
    jobId: s.jobId,
  });
  expect(
    worker.profiles.find((a) => a.id === "stats-core")?.reservePriceYocto,
  ).toBe(override);
  expect(
    JSON.stringify(
      await s.buyer.query(api.marketViews.agent, { agentId: "stats-core" }),
    ),
  ).not.toContain(override);
  await expect(
    s.t.mutation(internal.workflow.award, {
      bidId: s.bidId,
      selectionReason: "stale floor",
    }),
  ).rejects.toThrow("PRIVATE_PRICING_CHANGED_REASSESS");
});
it("rejects malformed private pricing configuration instead of falling back silently", async () => {
  const s = await setup();
  for (const value of [
    '{"unknown-agent":"1"}',
    '{"stats-core":"1.5"}',
    "not-json",
  ]) {
    vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON", value);
    await expect(
      s.t.query(internal.workflow.pricingContext, { jobId: s.jobId }),
    ).rejects.toThrow("AGENT_PRICING_CONFIGURATION_INVALID");
  }
});
it("records the parent seller as the economic buyer when it hires a subcontractor", async () => {
  const s = await setup();
  await s.t.mutation(internal.workflow.award, {
    bidId: s.bidId,
    selectionReason: "Parent award",
  });
  const child = await s.t.mutation(internal.workflow.subcontract, {
    parentId: s.jobId,
    budgetYocto: "300000000000000000000000",
    options: { columns: ["x"] },
  });
  const childBid = await s.t.mutation(internal.workflow.recordBid, {
    jobId: child,
    agentId: "clean-sprint",
    priceYocto: "200000000000000000000000",
    minimumYocto: "100000000000000000000000",
    etaMs: 100,
    rationale: "Child offer",
  });
  await s.t.mutation(internal.workflow.negotiate, {
    bidId: childBid,
    actorRole: "buyer",
    round: 2,
    action: "accept",
    priceYocto: "200000000000000000000000",
    explanation: "Parent hires child",
  });
  const row = (await s.buyer.query(api.jobs.detail, { id: child }))
    .negotiations[0];
  expect(row.actorRole).toBe("buyer");
  expect(row.actorId).toBe("stats-core");
});

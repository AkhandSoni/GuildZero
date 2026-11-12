import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { INITIAL_AGENTS } from "../../lib/agents";
import { makeBid, rankBids, respondToCounteroffer, runService, verifyDeliverable } from "../../lib/economy";
import type { Offer, Result, ServiceOutput, ServiceRequest } from "../../lib/economy";

const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => vi.unstubAllEnvs());
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
async function setup() {
  const t = convexTest(schema, modules);
  const [ownerId, outsiderId] = await t.run((ctx) => Promise.all([
    ctx.db.insert("users", { email: "combined-owner@example.com" }),
    ctx.db.insert("users", { email: "combined-outsider@example.com" }),
  ]));
  const owner = t.withIdentity({ subject: `${ownerId}|test` });
  const outsider = t.withIdentity({ subject: `${outsiderId}|test` });
  const missionId = await owner.mutation(api.missions.create, {
    title: "Combined kernel and lifecycle regression",
    serviceType: "csv_summary",
    inputCsv: "product,units,price\n Bag , 3 , 12.5 \nNotebook,5,4",
    options: { columns: ["units", "price"] },
    maxBudgetYocto: "1000000000000000000000000",
    acceptanceCriteria: "Selected column statistics must match the source.",
    deadlineAt: Date.now() + 86400000,
  });
  const jobId = await owner.mutation(api.jobs.start, { missionId });
  return { t, owner, outsider, ownerId, missionId, jobId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

// Test-owned coordination deliberately calls the existing internal transitions.
// It exercises real kernel outputs; it is not a production scheduler or UI bypass.
async function auction(s: Setup, jobId: Id<"jobs">) {
  const context = await s.t.query(internal.workflow.pricingContext, { jobId });
  const nowMs = Date.now();
  const offers: Offer[] = [];
  const ids = new Map<string, Id<"bids">>();
  for (const agent of context.profiles.filter((a) => a.capabilities.includes(context.job.serviceType))) {
    const decision = value(makeBid({
      agent,
      workload: { serviceType: context.job.serviceType, rowCount: 2, columnCount: 3, complexityBps: 0, riskBps: 0 },
      costModel: {
        baseCostYocto: context.job.depth === 0 ? "250000000000000000000000" : "10000000000000000000000",
        perRowCostYocto: "1000000000000000000000",
        perCellCostYocto: "100000000000000000000",
      },
      activeAssignments: 0, budgetYocto: context.job.budgetYocto,
      nowMs, deadlineAtMs: nowMs + 86400000, estimatedDurationMs: 1000, bidId: `${jobId}:${agent.id}`,
    }));
    if (decision.decision !== "offer") continue;
    const offer = decision.offer;
    const bidId = await s.t.mutation(internal.workflow.recordBid, {
      jobId, agentId: offer.agentId, priceYocto: offer.priceYocto,
      minimumYocto: offer.minimumAcceptableYocto, etaMs: offer.etaMs, rationale: offer.explanation,
    });
    ids.set(offer.bidId, bidId); offers.push(offer);
  }
  const ranked = value(rankBids({
    budgetYocto: context.job.budgetYocto, availableDurationMs: 86400000,
    offers, reputationBps: offers.map(() => 5000), capabilityMatchBps: offers.map(() => 10000),
  }));
  expect(ranked.length).toBeGreaterThan(0);
  const offer = ranked[0].offer, bidId = ids.get(offer.bidId)!;
  if (context.job.depth === 0) {
    expect(offers).toHaveLength(3);
    const buyerOfferYocto = (BigInt(offer.priceYocto) * 98n / 100n).toString();
    await s.t.mutation(internal.workflow.negotiate, {
      bidId, round: 2, actorRole: "buyer", action: "counter", priceYocto: buyerOfferYocto,
      explanation: "Deterministic buyer requests a two percent discount.",
    });
    const decision = value(respondToCounteroffer({ currentOffer: offer, round: 3,
      buyerOfferYocto, budgetYocto: context.job.budgetYocto, sellerMinimumYocto: offer.minimumAcceptableYocto }));
    expect(decision.decision).toBe("accept");
    await s.t.mutation(internal.workflow.negotiate, {
      bidId, round: 3, actorRole: "seller", action: decision.action, priceYocto: decision.priceYocto,
      explanation: decision.explanation,
    });
  }
  await s.t.mutation(internal.workflow.award, {
    bidId, selectionReason: `Actual normalized score ${ranked[0].totalScore}; ${ranked[0].tieBreakExplanation}`,
  });
  return offer;
}

async function submit(s: Setup, jobId: Id<"jobs">, output: ServiceOutput) {
  const context = await s.t.query(internal.workflow.executionContext, { jobId });
  return s.t.mutation(internal.workflow.submit, {
    jobId, format: output.format,
    content: output.serviceType === "csv_normalize" ? output.csv : JSON.stringify(output),
    ...(context.dependencyDeliverableId ? { dependencyDeliverableId: context.dependencyDeliverableId } : {}),
  });
}
async function verifyStored(s: Setup, jobId: Id<"jobs">, deliverableId: Id<"deliverables">, request: ServiceRequest) {
  const detail = await s.owner.query(api.jobs.detail, { id: jobId });
  const stored = detail.deliverables.find((d) => d._id === deliverableId)!;
  const source = value(runService(request));
  const actual: unknown = request.serviceType === "csv_normalize"
    ? { ...source, csv: stored.content }
    : JSON.parse(stored.content);
  const verification = value(verifyDeliverable({ request, deliverable: actual }));
  await s.t.mutation(internal.workflow.recordVerification, {
    deliverableId, verdict: verification.verdict, checks: [...verification.checks],
  });
  return verification;
}

it("combines real competitive bids, negotiation, useful child output and verification with conserved payment allocations", async () => {
  const s = await setup();
  await auction(s, s.jobId);
  const childId = await s.t.mutation(internal.workflow.subcontract, {
    parentId: s.jobId, budgetYocto: "120000000000000000000000",
    options: { columns: ["product", "units", "price"], caseMode: "preserve" },
  });
  await auction(s, childId);
  const childContext = await s.t.query(internal.workflow.executionContext, { jobId: childId });
  const childRequest: ServiceRequest = { serviceType: "csv_normalize", inputCsv: childContext.inputCsv,
    options: { columns: childContext.job.options.columns, caseMode: "preserve" } };
  const childOutput = value(runService(childRequest));
  expect(childOutput).toMatchObject({ csv: "product,units,price\nBag,3,12.5\nNotebook,5,4" });
  const childDeliverable = await submit(s, childId, childOutput);
  expect((await verifyStored(s, childId, childDeliverable, childRequest)).verdict).toBe("pass");
  const parentContext = await s.t.query(internal.workflow.executionContext, { jobId: s.jobId });
  expect(parentContext.inputCsv).toBe(childOutput.serviceType === "csv_normalize" ? childOutput.csv : "");
  expect(parentContext.dependencyDeliverableId).toBe(childDeliverable);
  const parentRequest: ServiceRequest = { serviceType: "csv_summary", inputCsv: parentContext.inputCsv,
    options: { columns: parentContext.job.options.columns } };
  const parentOutput = value(runService(parentRequest));
  expect(parentOutput).toMatchObject({ rowCount: 2, columns: [{ name: "units", sum: 8 }, { name: "price", sum: 16.5 }] });
  const parentDeliverable = await submit(s, s.jobId, parentOutput);
  expect((await verifyStored(s, s.jobId, parentDeliverable, parentRequest)).verdict).toBe("pass");
  const parent = await s.owner.query(api.jobs.detail, { id: s.jobId });
  expect(parent.job.state).toBe("approved");
  expect(parent.negotiations.map((n) => [n.round, n.actorRole, n.action])).toEqual([[2, "buyer", "counter"], [3, "seller", "accept"]]);
  await expect(s.outsider.query(api.jobs.detail, { id: childId })).rejects.toThrow("JOB_NOT_FOUND");
  expect((await s.outsider.query(api.marketViews.overview, {})).jobs).toEqual([]);

  vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet");
  vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify(Object.fromEntries(INITIAL_AGENTS.filter((a) => a.capabilities.length).map((a) => [a.id, `${a.id}.testnet`]))));
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "false");
  for (const jobId of [s.jobId, childId]) expect(await s.owner.mutation(api.payments.prepare, { jobId })).toMatchObject({ ok: true });
  const parentIntent = (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))!;
  const childIntent = (await s.owner.query(api.payments.forJob, { jobId: childId }))!;
  expect(BigInt(parentIntent.amountYocto) + BigInt(childIntent.amountYocto)).toBe(BigInt(parent.job.reservedYocto));
  expect(parentIntent.deliverableId).toBe(parentDeliverable);
  expect(childIntent.deliverableId).toBe(childDeliverable);
  expect(await s.owner.mutation(api.payments.authorize, { intentId: parentIntent._id,
    recipient: parentIntent.recipient, amountYocto: parentIntent.amountYocto }))
    .toEqual({ ok: false, code: "SETTLEMENT_CONFIGURATION_REQUIRED" });
  expect(await s.t.run((ctx) => ctx.db.query("signerLocks").collect())).toEqual([]);
  expect(await s.t.run((ctx) => ctx.db.query("reputationEvents").collect())).toHaveLength(2);
});

it("rejects a tampered computed result and accepts one corrected revision without duplicate reputation", async () => {
  const s = await setup();
  await auction(s, s.jobId);
  const context = await s.t.query(internal.workflow.executionContext, { jobId: s.jobId });
  const request: ServiceRequest = { serviceType: "csv_summary", inputCsv: context.inputCsv,
    options: { columns: context.job.options.columns } };
  const correct = value(runService(request));
  if (correct.serviceType !== "csv_summary") throw new Error("Expected statistics");
  const forged = { ...correct, columns: correct.columns.map((column, i) => i ? column : { ...column, sum: 999 }) };
  const badId = await submit(s, s.jobId, forged);
  expect((await verifyStored(s, s.jobId, badId, request)).verdict).toBe("fail");
  expect((await s.owner.query(api.jobs.detail, { id: s.jobId })).job.state).toBe("revision");
  expect(await s.t.run((ctx) => ctx.db.query("reputationEvents").collect())).toEqual([]);
  const goodId = await submit(s, s.jobId, correct);
  expect((await verifyStored(s, s.jobId, goodId, request)).verdict).toBe("pass");
  const final = await s.owner.query(api.jobs.detail, { id: s.jobId });
  expect(final.job.state).toBe("approved");
  expect(final.deliverables).toHaveLength(2);
  expect(final.verifications.map((v) => v.verdict)).toEqual(["fail", "pass"]);
  await expect(submit(s, s.jobId, correct)).rejects.toThrow("JOB_NOT_EXECUTABLE");
  expect(await s.t.run((ctx) => ctx.db.query("reputationEvents").collect())).toHaveLength(1);
});

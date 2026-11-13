import { awardPaymentBlock } from "./settlementReadiness";
// Bounded deterministic workflow. Every stage is an atomic, versioned mutation.
// There are no network calls, browser worker endpoints or automatic payments.
import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { privateProfiles } from "./agentPolicies";
import { event, reviewCapacity } from "./workflowHelpers";
import { parseBoundedCsv } from "../lib/economy/csv-input";
import { makeBid, rankBids, respondToCounteroffer, runService, verifyDeliverable } from "../lib/economy";
import type { Offer, Result, ServiceRequest } from "../lib/economy";
const args = { jobId: v.id("jobs"), version: v.number() };
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new ConvexError(result.code);
  return result.value;
}
async function next(ctx: MutationCtx, job: Doc<"jobs">): Promise<void> {
  const version = (job.workerVersion ?? 0) + 1;
  await ctx.db.patch(job._id, { workerVersion: version, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(700, internal.economyWorker.step, { jobId: job._id, version });
}
async function unavailable(ctx: MutationCtx, job: Doc<"jobs">, reason: string): Promise<void> {
  await ctx.db.patch(job._id, { state: "unawarded", updatedAt: Date.now() });
  await event(ctx, job, "AUCTION_UNAWARDED", reason);
  if (job.parentId) {
    const parent = await ctx.db.get(job.parentId);
    if (parent?.state === "working") {
      await ctx.db.patch(parent._id, { state: "disputed", updatedAt: Date.now() });
      await ctx.db.insert("disputes", { jobId: parent._id, reason: "Required subcontract could not be awarded" });
      await reviewCapacity(ctx, parent);
      await event(ctx, parent, "DEPENDENCY_FAILED", "The required child has no eligible offer. Owner may reject this contract.");
    }
  }
}
function snapshot(bid: Doc<"bids">, profiles: ReturnType<typeof privateProfiles>): Offer {
  const profile = profiles.find((p) => p.id === bid.agentId)!;
  return { agentId: bid.agentId, bidId: bid._id, priceYocto: bid.priceYocto,
    minimumAcceptableYocto: bid.minimumYocto, estimatedCostYocto: bid.estimatedCostYocto ?? "0",
    etaMs: bid.etaMs, strategy: profile.strategy!, explanation: "Stored eligible offer." };
}
async function run(ctx: MutationCtx, job: Doc<"jobs">): Promise<void> {
  const mission = await ctx.db.get(job.missionId);
  if (!mission) throw new ConvexError("MISSION_NOT_FOUND");
  if (mission.deadlineAt <= Date.now() && job.state === "bidding") {
    await unavailable(ctx, job, "Mission deadline expired before an award."); return;
  }
  if (job.state === "bidding") {
    const profiles = privateProfiles();
    let bids = await ctx.db.query("bids").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(10);
    if (!bids.length) {
      const source = value(parseBoundedCsv(job.inputCsv));
      for (const agent of profiles.filter((p) => p.capabilities.length)) {
        await event(ctx, job, "AGENT_DISCOVERED", `${agent.name} inspected this service brief.`);
        const active = await ctx.db.query("contracts").withIndex("by_agent_state", (q) => q.eq("agentId", agent.id).eq("state", "active")).take(agent.capacity);
        const reputation = await ctx.db.query("reputationEvents").withIndex("by_agent", (q) => q.eq("agentId", agent.id)).order("desc").take(100);
        const reputationBps = Math.min(10000, Math.max(0, 5000 + reputation.reduce((total, e) => total + e.delta * 10, 0)));
        const scale = agent.role === "cleaning" ? 1n : agent.role === "statistics" ? 2n : 3n;
        const decision = value(makeBid({
          agent, workload: { serviceType: job.serviceType, rowCount: source.rawRows.length, columnCount: source.rawHeader.length,
            complexityBps: job.serviceType === "csv_summary" ? 500 : 0, riskBps: source.rawRows.some((r) => r.some((c) => !c.trim())) ? 500 : 0 },
          costModel: { baseCostYocto: (scale * 10n ** 23n + (job.depth === 0 && job.cleanBeforeProcessing ? 15n * 10n ** 22n : 0n)).toString(), perRowCostYocto: (scale * 10n ** 20n).toString(), perCellCostYocto: (scale * 10n ** 19n).toString() },
          activeAssignments: active.length, budgetYocto: job.budgetYocto, nowMs: Date.now(), deadlineAtMs: mission.deadlineAt,
          estimatedDurationMs: 1000 + source.rawRows.length * source.rawHeader.length * (agent.strategy === "conservative" ? 3 : 2),
          bidId: `${job._id}:${agent.id}`,
        }));
        if (decision.decision === "decline") {
          await event(ctx, job, "AGENT_DECLINED", `${agent.name}: ${decision.decline.code}.`); continue;
        }
        const offer = decision.offer;
        await ctx.runMutation(internal.workflow.recordBid, { jobId: job._id, agentId: agent.id, priceYocto: offer.priceYocto,
          minimumYocto: offer.minimumAcceptableYocto, etaMs: offer.etaMs, rationale: offer.explanation,
          estimatedCostYocto: offer.estimatedCostYocto, reputationBps });
      }
      bids = await ctx.db.query("bids").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(10);
      if (!bids.length) await unavailable(ctx, job, "No eligible profitable seller is available within the budget, capacity and deadline.");
      else await next(ctx, job);
      return;
    }
    const history = await ctx.db.query("negotiations").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(30);
    const candidates: Offer[] = [];
    for (const bid of bids) {
      const profile = profiles.find((p) => p.id === bid.agentId);
      if (!profile?.strategy) continue;
      const prior = history.filter((n) => n.bidId === bid._id);
      if (prior.length) {
        const accepted = prior.find((n) => n.action === "accept");
        if (accepted) candidates.push({ ...snapshot(bid, profiles), priceYocto: accepted.priceYocto });
        continue;
      }
      // Buyer proposes a price without consulting the private seller floor.
      const proposed = ((BigInt(bid.priceYocto) * 98n) / 100n || 1n).toString();
      await ctx.runMutation(internal.workflow.negotiate, { bidId: bid._id, round: 2, actorRole: "buyer", action: "counter", priceYocto: proposed, explanation: "Buyer requests a two percent discount within its spending cap." });
      const response = value(respondToCounteroffer({ currentOffer: snapshot(bid, profiles), round: 3, buyerOfferYocto: proposed,
        budgetYocto: job.budgetYocto, sellerMinimumYocto: BigInt(profile.reservePriceYocto) > BigInt(bid.minimumYocto) ? profile.reservePriceYocto : bid.minimumYocto }));
      await ctx.runMutation(internal.workflow.negotiate, { bidId: bid._id, round: 3, actorRole: "seller", action: response.action, priceYocto: response.priceYocto, explanation: response.explanation });
      if (response.decision === "accept") candidates.push(response.offer);
    }
    const active = new Set<string>();
    for (const profile of profiles) {
      const contracts = await ctx.db.query("contracts").withIndex("by_agent_state", (q) => q.eq("agentId", profile.id).eq("state", "active")).take(profile.capacity);
      if (contracts.length >= profile.capacity) active.add(profile.id);
    }
    const eligible = candidates.filter((b) => !active.has(b.agentId) && !awardPaymentBlock(job,b.agentId,b.priceYocto));
    const ranked = value(rankBids({ budgetYocto: job.budgetYocto, availableDurationMs: Math.max(1, mission.deadlineAt - Date.now()),
      offers: eligible, reputationBps: eligible.map((b) => bids.find((stored) => stored._id === b.bidId)?.reputationBps ?? 5000), capabilityMatchBps: eligible.map(() => 10000) }));
    if (!ranked.length) { await unavailable(ctx, job, "No accepted offer meets current settlement configuration, the 1 NEAR award cap, capacity and negotiation rules. Create a revised mission to try again."); return; }
    const best = ranked[0];
    await ctx.runMutation(internal.workflow.award, { bidId: best.offer.bidId as Id<"bids">,
      selectionReason: `Normalized utility ${best.totalScore} bps. Deterministic tiebreak: ${best.tieBreakExplanation}.`,
      score: { price: best.priceScore, time: best.etaScore, reputation: best.reputationScore, capability: best.capabilityScore, total: best.totalScore } });
    await next(ctx, job); return;
  }
  if (job.state === "working" || job.state === "revision") {
    if (mission.deadlineAt <= Date.now()) {
      await ctx.db.patch(job._id, { state: "disputed", updatedAt: Date.now() });
      await ctx.db.insert("disputes", { jobId: job._id, reason: "Execution deadline expired; owner review required" });
      await reviewCapacity(ctx, job);
      await event(ctx, job, "DEADLINE_REVIEW", "Committed work passed its deadline and requires a human decision."); return;
    }
    const child = await ctx.db.query("jobs").withIndex("by_parent", (q) => q.eq("parentId", job._id)).unique();
    if (job.depth === 0 && job.cleanBeforeProcessing && !child) {
      const contract = await ctx.db.query("contracts").withIndex("by_job", (q) => q.eq("jobId", job._id)).unique();
      if (!contract) throw new ConvexError("NO_CONTRACT");
      const source = value(parseBoundedCsv(job.inputCsv));
      const budgetYocto = (BigInt(contract.amountYocto) * 45n / 100n).toString();
      const childId = await ctx.runMutation(internal.workflow.subcontract, { parentId: job._id, budgetYocto, options: { columns: source.rawHeader, caseMode: "preserve" } });
      await ctx.db.patch(job._id, { workerVersion: (job.workerVersion ?? 0) + 1 });
      await ctx.scheduler.runAfter(0, internal.economyWorker.step, { jobId: childId, version: 0 }); return;
    }
    if (child && child.state !== "approved") return;
    const context = await ctx.runQuery(internal.workflow.executionContext, { jobId: job._id });
    const request: ServiceRequest = job.serviceType === "csv_normalize"
      ? { serviceType: "csv_normalize", inputCsv: context.inputCsv, options: { columns: job.options.columns, caseMode: job.options.caseMode ?? "preserve" } }
      : { serviceType: "csv_summary", inputCsv: context.inputCsv, options: { columns: job.options.columns } };
    const executed = runService(request);
    if (!executed.ok) {
      // Input that cannot be executed must not become a fabricated deliverable.
      await ctx.db.patch(job._id, { state: "disputed", updatedAt: Date.now() });
      await ctx.db.insert("disputes", { jobId: job._id, reason: `Service could not execute: ${executed.code}: ${executed.message.slice(0, 600)} No deliverable exists; reject and create a revised brief.` });
      await reviewCapacity(ctx, job);
      await event(ctx, job, "EXECUTION_REQUIRES_REVIEW", `${executed.code}: ${executed.message.slice(0, 600)} No output or automatic approval was fabricated.`); return;
    }
    const output = executed.value;
    await ctx.runMutation(internal.workflow.submit, { jobId: job._id, format: output.format,
      content: output.serviceType === "csv_normalize" ? output.csv : JSON.stringify(output), verificationPayload: JSON.stringify(output),
      ...(context.dependencyDeliverableId ? { dependencyDeliverableId: context.dependencyDeliverableId } : {}) });
    await next(ctx, job); return;
  }
  if (job.state === "verifying") {
    const deliverable = await ctx.db.query("deliverables").withIndex("by_job", (q) => q.eq("jobId", job._id)).order("desc").first();
    if (!deliverable?.verificationPayload) throw new ConvexError("VERIFICATION_PAYLOAD_MISSING");
    const child = await ctx.db.query("jobs").withIndex("by_parent", (q) => q.eq("parentId", job._id)).unique();
    const dependency = child ? await ctx.db.query("deliverables").withIndex("by_job", (q) => q.eq("jobId", child._id)).order("desc").first() : null;
    if (child && (child.state !== "approved" || dependency?._id !== deliverable.dependencyDeliverableId)) throw new ConvexError("DEPENDENCY_OUTPUT_NOT_BOUND");
    const inputCsv = dependency?.content ?? job.inputCsv;
    const request: ServiceRequest = job.serviceType === "csv_normalize"
      ? { serviceType: "csv_normalize", inputCsv, options: { columns: job.options.columns, caseMode: job.options.caseMode ?? "preserve" } }
      : { serviceType: "csv_summary", inputCsv, options: { columns: job.options.columns } };
    const actual = job.serviceType === "csv_normalize"
      ? { ...JSON.parse(deliverable.verificationPayload), csv: deliverable.content }
      : JSON.parse(deliverable.content);
    const verified = value(verifyDeliverable({ request, deliverable: actual,
      ...(job.requiresHumanReview ? { acceptanceCriteria: mission.acceptanceCriteria } : {}) }));
    await ctx.runMutation(internal.workflow.recordVerification, { deliverableId: deliverable._id, verdict: verified.verdict, checks: [...verified.checks] });
    if (verified.verdict === "fail" && job.revisionCount === 0) await next(ctx, job);
    return;
  }
}
export const advance = internalMutation({ args, handler: async (ctx, { jobId, version }): Promise<null> => {
  const job = await ctx.db.get(jobId);
  if (!job?.engineManaged || job.workerError || (job.workerVersion ?? 0) !== version || !["bidding", "working", "revision", "verifying"].includes(job.state)) return null;
  await run(ctx, job); return null;
} });
export const step = internalMutation({ args, handler: async (ctx, input): Promise<null> => {
  try { await ctx.runMutation(internal.economyWorker.advance, input); }
  catch {
    // Subtransaction rolled back; preserve a bounded, sanitized failure audit.
    const job = await ctx.db.get(input.jobId);
    if (job && job.workerVersion === input.version && ["bidding", "working", "revision", "verifying"].includes(job.state)) {
      if ((job.retryCount ?? 0) >= 3) {
        await ctx.db.patch(job._id, { workerError: undefined });
        if (job.state === "bidding") await unavailable(ctx, job, "The workflow exhausted its three owner retries before an award. No payment was requested.");
        else {
          await ctx.db.patch(job._id, { state: "disputed", updatedAt: Date.now() });
          await ctx.db.insert("disputes", { jobId: job._id, reason: "Workflow retries exhausted. Owner review required; no payment was requested." });
          await reviewCapacity(ctx, job);
          await event(ctx, job, "WORKFLOW_RETRY_LIMIT", "Three owner retries exhausted. Processing capacity released; financial obligations remain reserved for review.");
        }
        return null;
      }
      await ctx.db.patch(job._id, { workerError: "WORKFLOW_PAUSED_RETRY_AVAILABLE" });
      await event(ctx, job, "WORKFLOW_PAUSED", "This stage could not finish safely. Owner may retry the same stage up to three times; no payment was requested.");
    }
  }
  return null;
} });

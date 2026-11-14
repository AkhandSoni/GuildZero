import { ConvexError, v } from "convex/values";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal, components } from "./_generated/api";
import { user } from "./ownership";
import { ownedRun, planningContext, planBinding, masterEvent, boundMissions, policyFingerprint, masterAutopayEnabled } from "./masterHelpers";
import { fingerprint, validateContext, validatePlan, PlanError } from "../lib/master-agent/plan";
import { configuration } from "../lib/settlement/policy";
import { PUBLIC_AGENTS } from "../lib/agent-directory";
import { deliveryAccess } from "./deliveryAccess";
import { contentRemovalSnapshot, removeOwnedContent } from "./retention";
const limiter = new RateLimiter(components.legacyAuthLimiter, {
  masterPlanning: { kind: "token bucket", rate: 2, period: MINUTE, capacity: 2 },
  masterGlobal: { kind: "token bucket", rate: 2, period: MINUTE, capacity: 2 },
});
const dataset = v.object({ ref: v.string(), name: v.string(), csv: v.string() });
export const create = mutation({
  args: { requestId: v.string(), prompt: v.string(), datasets: v.array(dataset), capYocto: v.string(), deadlineAt: v.number(), requiresHumanReview: v.boolean() },
  handler: async (ctx, args): Promise<Id<"masterRuns">> => {
    const ownerId = await user(ctx);
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(args.requestId)) throw new ConvexError("INVALID_REQUEST_ID");
    try { validateContext({ ...args, clarifications: [] }); } catch { throw new ConvexError("INVALID_MASTER_REQUEST"); }
    const requestHash = await fingerprint(args);
    const old = await ctx.db.query("masterRuns").withIndex("by_owner_request", q => q.eq("ownerId", ownerId).eq("requestId", args.requestId)).unique();
    if (old) {
      if (old.requestHash !== requestHash) throw new ConvexError("REQUEST_ID_CONFLICT");
      return old._id;
    }
    const datasets = await Promise.all(args.datasets.map(async d => ({ ...d, digest: await fingerprint(d.csv) })));
    const datasetHash = await fingerprint(datasets.map(d => ({ ref: d.ref, digest: d.digest })));
    const now = Date.now();
    return ctx.db.insert("masterRuns", { ...args, datasets, ownerId, requestHash, datasetHash,
      clarifications: [], revision: 1, planningAttempts: 0, state: "ready", createdAt: now, updatedAt: now });
  },
});
export const list = query({ args: {}, handler: async ctx => {
  const ownerId = await user(ctx);
  return (await ctx.db.query("masterRuns").withIndex("by_owner", q => q.eq("ownerId", ownerId)).order("desc").take(21))
    .slice(0, 20).map(r => ({ id: r._id, title: r.prompt.slice(0, 100), state: r.state, createdAt: r.createdAt }));
} });
export const get = query({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }) => {
  const run = await ownedRun(ctx, runId);
  const steps = await ctx.db.query("masterSteps").withIndex("by_run", q => q.eq("runId", runId)).take(4);
  const grants = await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", runId)).order("desc").take(1);
  const events = await ctx.db.query("masterEvents").withIndex("by_run", q => q.eq("runId", runId)).order("desc").take(50);
  let committed = 0n, confirmed = 0n, pending = 0n;
  for (const step of steps) if (step.jobId) {
    const job = await ctx.db.get(step.jobId);
    if (!job || job.ownerId !== run.ownerId) continue;
    const access = await deliveryAccess(ctx, job);
    const root = access.obligations.find(o => o.job._id === job._id);
    if (root?.contract) committed += BigInt(root.contract.amountYocto);
    for (const obligation of access.obligations) {
      if (obligation.confirmed) confirmed += BigInt(obligation.payment!.amountYocto);
      else if (obligation.payment && ["SUBMITTING", "CONFIRMING", "UNKNOWN_RECONCILE"].includes(obligation.payment.status)) pending += BigInt(obligation.payment.amountYocto);
    }
  }
  return { run: { id: run._id, prompt: run.prompt, datasets: run.datasets.map(d => ({ ref: d.ref, name: d.name })),
    capYocto: run.capYocto, deadlineAt: run.deadlineAt, requiresHumanReview: run.requiresHumanReview,
    state: run.state, revision: run.revision, planJson: run.planJson ?? null, planHash: run.planHash ?? null,
    acceptedAt: run.acceptedAt ?? null, error: run.error ?? null, clarifications: run.clarifications, inference: run.inference ?? null },
    steps, events, grant: grants[0] ? { id: grants[0]._id, capYocto: grants[0].capYocto, expiresAt: grants[0].expiresAt, revokedAt: grants[0].revokedAt ?? null, expired: grants[0].expiresAt <= Date.now() } : null,
    financials: { committedYocto: committed.toString(), confirmedTransfersYocto: confirmed.toString(), pendingTransfersYocto: pending.toString() },
    autopayEnabled: masterAutopayEnabled() };
} });
export const context = query({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }) => {
  const run = await ownedRun(ctx, runId);
  return { context: planningContext(run), revision: run.revision, accepted: !!run.acceptedAt };
} });
export const beginPlanning = mutation({ args: { runId: v.id("masterRuns"), revision: v.number() }, handler: async (ctx, args) => {
  const run = await ownedRun(ctx, args.runId);
  if (run.acceptedAt || run.cancelledAt || run.revision !== args.revision || (run.planningClaimUntil ?? 0) > Date.now() || run.planningAttempts >= 3)
    throw new ConvexError("PLANNING_NOT_AVAILABLE");
  if (!(await limiter.limit(ctx, "masterPlanning", { key: run.ownerId })).ok || !(await limiter.limit(ctx, "masterGlobal", { key: "groq" })).ok)
    throw new ConvexError("PLANNING_RATE_LIMIT");
  const token = Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, "0")).join("");
  await ctx.db.patch(run._id, { planningClaimToken: token, planningClaimUntil: Date.now() + 45000,
    planningAttempts: run.planningAttempts + 1, state: "planning", error: undefined, updatedAt: Date.now() });
  return { token, context: planningContext(run) };
} });
export const finishPlanning = mutation({ args: { runId: v.id("masterRuns"), revision: v.number(), token: v.string(),
  planJson: v.optional(v.string()), error: v.optional(v.string()),
  inference: v.optional(v.object({ provider: v.literal("groq"), model: v.string(), inferenceMs: v.number(), requests: v.number(), inputTokens: v.union(v.number(), v.null()), outputTokens: v.union(v.number(), v.null()), planningMs: v.number() })),
}, handler: async (ctx, args) => {
  const run = await ownedRun(ctx, args.runId);
  if (run.acceptedAt || run.cancelledAt || run.revision !== args.revision || run.planningClaimToken !== args.token || (run.planningClaimUntil ?? 0) < Date.now())
    throw new ConvexError("PLANNING_RESPONSE_STALE");
  let planJson: string | undefined, planHash: string | undefined, state = "failed", error: string | undefined;
  try {
    if (!args.planJson || new TextEncoder().encode(args.planJson).length > 32768) throw new PlanError("PLANNING_FAILED", "Planning failed.");
    const checked = validatePlan(JSON.parse(args.planJson), planningContext(run));
    planJson = JSON.stringify(checked.plan); planHash = await planBinding(run, checked.plan);
    state = checked.plan.decision === "execute" ? "ready_to_accept" : checked.plan.decision === "clarify" ? "needs_clarification" : "unsupported";
  } catch (e) { error = e instanceof PlanError ? e.code : "INVALID_PLAN_JSON"; }
  if (args.error) error = /^[A-Z_]{3,80}$/.test(args.error) ? args.error : "PLANNING_FAILED";
  const inference = args.inference;
  if (inference && (inference.model.length > 150 || inference.requests !== 1 || !Number.isSafeInteger(inference.inferenceMs) || inference.inferenceMs < 0 ||
      !Number.isSafeInteger(inference.planningMs) || inference.planningMs < 0 || inference.inferenceMs > 120000 || inference.planningMs > 180000 ||
      [inference.inputTokens, inference.outputTokens].some(n => n !== null && (!Number.isSafeInteger(n) || n < 0)))) throw new ConvexError("INVALID_INFERENCE_METADATA");
  await ctx.db.patch(run._id, { state: error ? "failed" : state, planJson: error ? undefined : planJson,
    planHash: error ? undefined : planHash, inference, error, planningClaimToken: undefined, planningClaimUntil: undefined, updatedAt: Date.now() });
  await masterEvent(ctx, run, error ? "PLAN_REJECTED" : "PLAN_PROPOSED", error ? "Planning stopped: " + error : "A schema-validated proposal is ready. No mission or spending authority was created.");
  return { ok: !error, code: error ?? null };
} });
export const clarify = mutation({ args: { runId: v.id("masterRuns"), reply: v.string() }, handler: async (ctx, args) => {
  const run = await ownedRun(ctx, args.runId);
  if (run.acceptedAt || run.cancelledAt || (run.planningClaimUntil ?? 0) > Date.now() || run.clarifications.length >= 3 || !args.reply.trim() || args.reply.length > 1000)
    throw new ConvexError("CLARIFICATION_NOT_AVAILABLE");
  await ctx.db.patch(run._id, { clarifications: [...run.clarifications, args.reply.trim()], revision: run.revision + 1,
    planningAttempts: 0, planningClaimToken: undefined, planningClaimUntil: undefined,
    planJson: undefined, planHash: undefined, inference: undefined, error: undefined, state: "ready", updatedAt: Date.now() });
  return run.revision + 1;
} });
export const accept = mutation({ args: { runId: v.id("masterRuns"), planHash: v.string(), allowUnfundedPreview: v.boolean() }, handler: async (ctx, args): Promise<void> => {
  const run = await ownedRun(ctx, args.runId);
  if (run.planHash !== args.planHash || !run.planJson || run.cancelledAt) throw new ConvexError("MASTER_PLAN_CHANGED");
  if (run.acceptedAt) return;
  const checked = validatePlan(JSON.parse(run.planJson), planningContext(run));
  if (checked.plan.decision !== "execute" || await planBinding(run, checked.plan) !== run.planHash) throw new ConvexError("MASTER_PLAN_NOT_EXECUTABLE");
  for (const [i, mission] of checked.missions.entries()) {
    const missionId = await ctx.runMutation(api.missions.create, mission);
    const stepId = await ctx.db.insert("masterSteps", { runId: run._id, ownerId: run.ownerId, stepId: checked.plan.steps[i].stepId, missionId });
    const jobId = await ctx.runMutation(api.jobs.start, { missionId, allowUnfundedPreview: args.allowUnfundedPreview });
    await ctx.db.patch(stepId, { jobId });
  }
  await ctx.db.patch(run._id, { acceptedAt: Date.now(), state: "executing", updatedAt: Date.now() });
  await masterEvent(ctx, run, "PLAN_ACCEPTED", "Private missions started through the existing marketplace. No payment was authorized.");
  await ctx.scheduler.runAfter(0, internal.masterAgentWorker.step, { runId: run._id });
} });
export const spendingReview = query({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }) => {
  const run = await ownedRun(ctx, runId);
  if (!run.acceptedAt) return null;
  try {
    const { steps, plan } = await boundMissions(ctx, run);
    const config = configuration();
    const services = new Set(plan.steps.map(s => s.serviceType));
    if (plan.steps.some(s => s.cleanBeforeProcessing)) services.add("csv_normalize");
    const recipients = PUBLIC_AGENTS.filter(a => a.capabilities.some(service => services.has(service))).flatMap(a =>
      typeof config.recipients[a.id] === "string" ? [{ agentId: a.id, accountId: config.recipients[a.id] as string }] : []);
    return { capYocto: plan.proposedTotalBudgetYocto!, planHash: run.planHash!, policyHash: await policyFingerprint(),
      missions: steps.map(s => s.missionId), expiresAt: Math.min(run.deadlineAt, Date.now() + 3600000), enabled: masterAutopayEnabled(),
      operator: config.sender, recipients,
      gasPolicy: "Contract transfers are capped. Actual testnet gas is separate; the signer retains its 0.01 NEAR liquidity reserve." };
  } catch { return null; }
} });
export const authorizeSpending = mutation({ args: { runId: v.id("masterRuns"), planHash: v.string(), policyHash: v.string(), capYocto: v.string(), expiresAt: v.number(), purpose: v.literal("human_mission_spending") },
  handler: async (ctx, args): Promise<Id<"masterGrants">> => {
    const run = await ownedRun(ctx, args.runId);
    if (!masterAutopayEnabled()) throw new ConvexError("MASTER_AUTOPAY_DISABLED");
    const { plan } = await boundMissions(ctx, run);
    if (run.planHash !== args.planHash || args.capYocto !== plan.proposedTotalBudgetYocto || args.policyHash !== await policyFingerprint() ||
        !Number.isSafeInteger(args.expiresAt) || args.expiresAt <= Date.now() || args.expiresAt > Math.min(run.deadlineAt, Date.now() + 3600000))
      throw new ConvexError("MASTER_SPENDING_SCOPE_CHANGED");
    const old = await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", run._id)).order("desc").take(6);
    const active = old.find(g => !g.revokedAt && g.expiresAt > Date.now());
    if (active) {
      if (active.planHash !== args.planHash || active.policyHash !== args.policyHash || active.capYocto !== args.capYocto)
        throw new ConvexError("MASTER_REVOKE_CHANGED_AUTHORIZATION_FIRST");
      return active._id;
    }
    if (old.length >= 5) throw new ConvexError("MASTER_GRANT_LIMIT");
    const grantId = await ctx.db.insert("masterGrants", { runId: run._id, ownerId: run.ownerId, planHash: args.planHash,
      datasetHash: run.datasetHash, capYocto: args.capYocto, policyHash: args.policyHash, expiresAt: args.expiresAt, createdAt: Date.now() });
    await masterEvent(ctx, run, "HUMAN_SPENDING_AUTHORIZED", "Human authorized the displayed mission bundle and transfer cap. Gas is separate; this does not approve disputed work.");
    await ctx.scheduler.runAfter(0, internal.masterAgentWorker.step, { runId: run._id });
    return grantId;
  },
});
export const revokeSpending = mutation({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }): Promise<void> => {
  const run = await ownedRun(ctx, runId);
  const grants = await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", runId)).take(6);
  for (const grant of grants) if (!grant.revokedAt) await ctx.db.patch(grant._id, { revokedAt: Date.now() });
  await masterEvent(ctx, run, "SPENDING_REVOKED", "New automatic authorizations are stopped. Signing already admitted or broadcast cannot be cancelled.");
  await ctx.scheduler.runAfter(0, internal.masterAgentWorker.step, { runId });
} });
export const refresh = mutation({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }): Promise<void> => {
  const run = await ownedRun(ctx, runId);
  if (!run.acceptedAt || run.cancelledAt) throw new ConvexError("MASTER_PLAN_NOT_ACTIVE");
  await ctx.db.patch(runId, { settlementChecks: 0, nextSettlementCheckAt: undefined });
  await ctx.scheduler.runAfter(0, internal.masterAgentWorker.step, { runId });
} });
export const cancel = mutation({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }): Promise<void> => {
  const run = await ownedRun(ctx, runId);
  if (run.cancelledAt) return;
  const grants = await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", runId)).take(6);
  for (const grant of grants) if (!grant.revokedAt) await ctx.db.patch(grant._id, { revokedAt: Date.now() });
  const steps = await ctx.db.query("masterSteps").withIndex("by_run", q => q.eq("runId", runId)).take(4);
  for (const step of steps) if (step.jobId && (await ctx.db.get(step.jobId))?.state === "bidding")
    await ctx.runMutation(api.jobs.cancel, { id: step.jobId });
  await ctx.db.patch(runId, { cancelledAt: Date.now(), state: "cancelled", updatedAt: Date.now() });
  await masterEvent(ctx, run, "RUN_CANCELLED", "Stopped delegation and cancelled unawarded work. Committed work and admitted transactions keep their original history.");
} });
export const removeContent = mutation({ args: { runId: v.id("masterRuns"), confirm: v.literal("REMOVE_PLANNER_AND_MISSION_CONTENT") }, handler: async (ctx, { runId }): Promise<void> => {
  const run = await ownedRun(ctx, runId);
  if (run.contentRemovedAt) return;
  if ((run.planningClaimUntil ?? 0) > Date.now()) throw new ConvexError("CANCEL_OR_FINISH_PLANNING_FIRST");
  const steps = await ctx.db.query("masterSteps").withIndex("by_run", q => q.eq("runId", runId)).take(4);
  if (steps.length > 3) throw new ConvexError("MASTER_STEP_STRUCTURE_INVALID");
  for (const step of steps) {
    const snapshot = await contentRemovalSnapshot(ctx, step.missionId);
    if (snapshot.mission.contentRemovedAt === undefined && snapshot.reason) throw new ConvexError(snapshot.reason);
  }
  const events = await ctx.db.query("masterEvents").withIndex("by_run", q => q.eq("runId", runId)).take(101);
  if (events.length > 100) throw new ConvexError("HISTORY_REQUIRES_OPERATOR_REVIEW");
  const grants = await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", runId)).take(6);
  for (const g of grants) if (!g.revokedAt) await ctx.db.patch(g._id, { revokedAt: Date.now() });
  for (const step of steps) await removeOwnedContent(ctx, step.missionId);
  for (const event of events) await ctx.db.patch(event._id, { detail: "Private planner content removed by owner" });
  await ctx.db.patch(runId, { prompt: "Content removed by owner", datasets: [], clarifications: [], planJson: undefined,
    cancelledAt: run.cancelledAt ?? Date.now(), contentRemovedAt: Date.now(), state: "content_removed", error: undefined,
    planningClaimToken: undefined, planningClaimUntil: undefined, updatedAt: Date.now() });
  await masterEvent(ctx, run, "PLANNER_CONTENT_REMOVED", "Owner removed planner inputs/proposals and all bound mission content. Financial identities and receipt evidence were retained.");
} });

import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { user } from "./ownership";
import { ownedRun, masterEvent, planningContext, planBinding, policyFingerprint, masterAutopayEnabled } from "./masterHelpers";
import { fingerprint, validatePlan } from "../lib/master-agent/plan";
import { activePaymentCap, configuration, testnetAccount } from "../lib/settlement/policy";
import { PUBLIC_AGENTS } from "../lib/agent-directory";
import { SERVICE_TYPES } from "../lib/services";
import { createOwned } from "./missions";
import { startOwned } from "./jobs";
import type { Doc, Id } from "./_generated/dataModel";

const purpose = v.literal("human_start_and_pay_verified");
const dataset = v.object({ ref: v.string(), name: v.string(), csv: v.string() });
export async function startPolicy(mode: "automatic" | "preview") {
  if (mode === "preview") return fingerprint({ version: "guildzero-start-v1", mode, services: SERVICE_TYPES, maxSteps: 3 });
  if (!masterAutopayEnabled()) throw new ConvexError("MASTER_AUTOPAY_DISABLED");
  if (process.env.NEAR_PAYMENT_RETRY_ENABLED === "true") throw new ConvexError("MASTER_V2_REQUIRES_EXACT_HUMAN_APPROVAL");
  const config = configuration();
  if (!config.enabled || activePaymentCap() === 0n || PUBLIC_AGENTS.filter(a => a.capabilities.length).some(a =>
    typeof config.recipients[a.id] !== "string" || !testnetAccount(config.recipients[a.id] as string) || config.recipients[a.id] === config.sender))
    throw new ConvexError("SETTLEMENT_CONFIGURATION_REQUIRED");
  return fingerprint({ version: "guildzero-start-v1", mode, policy: await policyFingerprint(), maxTransferYocto: activePaymentCap().toString(), services: SERVICE_TYPES, maxSteps: 3 });
}
export function consentPayload(c: NonNullable<Doc<"masterRuns">["startConsent"]>) {
  return { version: c.version, mode: c.mode, requestHash: c.requestHash, datasetHash: c.datasetHash,
    capYocto: c.capYocto, revision: c.revision, policyHash: c.policyHash, expiresAt: c.expiresAt, createdAt: c.createdAt };
}
export async function checkStartConsent(run: Doc<"masterRuns">) {
  const c = run.startConsent;
  if (!c || c.revokedAt !== undefined || run.cancelledAt || run.contentRemovedAt || c.expiresAt <= Date.now()) throw new ConvexError("START_AUTHORIZATION_INACTIVE");
  const requestHash = await fingerprint({ requestId: run.requestId, prompt: run.prompt,
    datasets: run.datasets.map(({ ref, name, csv }) => ({ ref, name, csv })), capYocto: run.capYocto,
    deadlineAt: run.deadlineAt, requiresHumanReview: run.requiresHumanReview });
  if (c.hash !== await fingerprint(consentPayload(c)) || c.requestHash !== requestHash || c.requestHash !== run.requestHash ||
      c.datasetHash !== run.datasetHash || c.capYocto !== run.capYocto || c.revision !== run.revision || run.clarifications.length ||
      c.expiresAt > Math.min(run.deadlineAt, c.createdAt + 3600000) || c.policyHash !== await startPolicy(c.mode))
    throw new ConvexError("START_AUTHORIZATION_CHANGED");
  for (const d of run.datasets) if (d.digest !== await fingerprint(d.csv)) throw new ConvexError("START_DATASET_CHANGED");
  if (run.datasetHash !== await fingerprint(run.datasets.map(({ ref, digest }) => ({ ref, digest })))) throw new ConvexError("START_DATASET_CHANGED");
  return c;
}
export const review = query({ args: {}, handler: async ctx => {
  await user(ctx);
  let enabled = false, policyHash = "", reason = "";
  try { policyHash = await startPolicy("automatic"); enabled = true; }
  catch (e) { reason = e instanceof ConvexError && typeof e.data === "string" ? e.data : "SETTLEMENT_CONFIGURATION_REQUIRED"; }
  let operator = "", recipients: { agentId: string; accountId: string }[] = [];
  try { const config = configuration(); operator = config.sender; recipients = PUBLIC_AGENTS.filter(a => a.capabilities.length).flatMap(a =>
    typeof config.recipients[a.id] === "string" ? [{ agentId: a.id, accountId: config.recipients[a.id] as string }] : []); } catch { /* fail closed above */ }
  return { enabled, policyHash, previewPolicyHash: await startPolicy("preview"), reason, operator, recipients,
    maxTransferYocto: activePaymentCap().toString(), expiresAt: Date.now() + 3600000 };
} });
export const start = mutation({ args: { requestId: v.string(), prompt: v.string(), datasets: v.array(dataset), capYocto: v.string(),
  deadlineAt: v.number(), requiresHumanReview: v.boolean(), mode: v.union(v.literal("automatic"), v.literal("preview")),
  policyHash: v.string(), expiresAt: v.number(), purpose }, handler: async (ctx, args): Promise<Id<"masterRuns">> => {
  const ownerId = await user(ctx);
  const { mode, policyHash, expiresAt, purpose: _purpose, ...input } = args;
  void _purpose;
  const old = await ctx.db.query("masterRuns").withIndex("by_owner_request", q => q.eq("ownerId", ownerId).eq("requestId", args.requestId)).unique();
  if (old) {
    if (old.requestHash !== await fingerprint(input) || !old.startConsent || old.startConsent.mode !== mode ||
        old.startConsent.policyHash !== policyHash || old.startConsent.expiresAt !== expiresAt) throw new ConvexError("REQUEST_ID_CONFLICT");
    return old._id; // Replay cannot renew, upgrade, revive or extend authority.
  }
  if (policyHash !== await startPolicy(mode) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Math.min(args.deadlineAt, Date.now() + 3600000))
    throw new ConvexError("START_AUTHORIZATION_CHANGED");
  const runId = await ctx.runMutation(api.masterAgent.create, input), run = (await ctx.db.get(runId))!;
  const consent = { version: "guildzero-start-v1" as const, mode, requestHash: run.requestHash, datasetHash: run.datasetHash,
    capYocto: run.capYocto, revision: run.revision, policyHash, expiresAt, createdAt: Date.now() };
  await ctx.db.patch(runId, { startConsent: { ...consent, hash: await fingerprint(consent) } });
  await masterEvent(ctx, run, "HUMAN_START_AUTHORIZED", mode === "automatic" ? "Human authorized supported CSV work and verified contract transfers within the submitted cap for at most one hour. Gas is separate; disputes remain human decisions." : "Human started processing-only preview. No spending was authorized; full results remain locked until separately confirmed settlement.");
  return runId;
} });

/** A nested mutation makes all mission/grant writes atomic even if admission fails. */
export const admit = internalMutation({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }): Promise<void> => {
  const run = await ctx.db.get(runId);
  if (!run || !(await ctx.db.get(run.ownerId))) throw new ConvexError("UNAUTHENTICATED");
  const c = await checkStartConsent(run);
  if (!run.planJson || !run.planHash) throw new ConvexError("MASTER_PLAN_NOT_EXECUTABLE");
  if (run.acceptedAt) {
    if (c.admittedPlanHash !== run.planHash) throw new ConvexError("START_AUTHORIZATION_CHANGED");
    return;
  }
  if (c.admittedPlanHash || (await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", runId)).take(1)).length ||
      (await ctx.db.query("masterSteps").withIndex("by_run", q => q.eq("runId", runId)).take(1)).length) throw new ConvexError("START_AUTHORIZATION_ALREADY_USED");
  const checked = validatePlan(JSON.parse(run.planJson), planningContext(run));
  if (checked.plan.decision !== "execute" || await planBinding(run, checked.plan) !== run.planHash ||
      BigInt(checked.plan.proposedTotalBudgetYocto!) > BigInt(c.capYocto)) throw new ConvexError("START_PLAN_OUTSIDE_AUTHORIZATION");
  for (const [i, mission] of checked.missions.entries()) {
    const missionId = await createOwned(ctx, mission, run.ownerId);
    const jobId = await startOwned(ctx, { missionId, allowUnfundedPreview: c.mode === "preview" }, run.ownerId);
    await ctx.db.insert("masterSteps", { runId, ownerId: run.ownerId, stepId: checked.plan.steps[i].stepId, missionId, jobId });
  }
  const now = Date.now();
  await ctx.db.patch(runId, { acceptedAt: now, state: "executing", startConsent: { ...c, admittedPlanHash: run.planHash }, updatedAt: now });
  if (c.mode === "automatic") await ctx.db.insert("masterGrants", { runId, ownerId: run.ownerId, planHash: run.planHash,
    datasetHash: run.datasetHash, capYocto: checked.plan.proposedTotalBudgetYocto!, policyHash: await policyFingerprint(),
    startConsentHash: c.hash, expiresAt: c.expiresAt, createdAt: now });
  await masterEvent(ctx, run, "START_PLAN_ADMITTED", "Deterministically validated work started under the original human Start. No model output supplied spending authority.");
  await ctx.scheduler.runAfter(0, internal.masterAgentWorker.step, { runId });
} });
export const abortPlanning = mutation({ args: { runId: v.id("masterRuns"), revision: v.number() }, handler: async (ctx, args) => {
  const run = await ownedRun(ctx, args.runId);
  if (!run.startConsent || run.acceptedAt || run.revision !== args.revision) return;
  await ctx.db.patch(run._id, { startConsent: { ...run.startConsent, revokedAt: run.startConsent.revokedAt ?? Date.now() },
    planningClaimToken: undefined, planningClaimUntil: undefined, state: "failed", error: "START_PLANNING_STOPPED", updatedAt: Date.now() });
  await masterEvent(ctx, run, "START_AUTHORIZATION_REVOKED", "Planning did not complete; unused Start authority was revoked. Submit a new Start to retry.");
} });

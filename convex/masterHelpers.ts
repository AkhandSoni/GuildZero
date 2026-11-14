import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { user } from "./ownership";
import { fingerprint, validatePlan, type PlanningContext } from "../lib/master-agent/plan";
import { configuration } from "../lib/settlement/policy";
import { PAYMENT_POLICY_VERSION } from "./paymentHelpers";
import { checkStartConsent } from "./masterStart";

export async function ownedRun(ctx: QueryCtx, id: Id<"masterRuns">) {
  const ownerId = await user(ctx), run = await ctx.db.get(id);
  if (!run || run.ownerId !== ownerId) throw new ConvexError("MASTER_RUN_NOT_FOUND");
  return run;
}
export function planningContext(run: Doc<"masterRuns">): PlanningContext {
  return { prompt: run.prompt, datasets: run.datasets.map(d => ({ ref: d.ref, name: d.name, csv: d.csv })),
    capYocto: run.capYocto, deadlineAt: run.deadlineAt, requiresHumanReview: run.requiresHumanReview,
    clarifications: run.clarifications };
}
export async function planBinding(run: Doc<"masterRuns">, plan: unknown) {
  return fingerprint({ plan, datasetHash: run.datasetHash, capYocto: run.capYocto,
    deadlineAt: run.deadlineAt, requiresHumanReview: run.requiresHumanReview });
}
export async function masterEvent(ctx: MutationCtx, run: Doc<"masterRuns">, type: string, detail: string) {
  await ctx.db.insert("masterEvents", { runId: run._id, ownerId: run.ownerId, type, detail, createdAt: Date.now() });
}
export const masterAutopayEnabled = () => process.env.MASTER_AGENT_AUTOPAY_ENABLED === "true";
export async function policyFingerprint() {
  const config = configuration();
  if (!config.enabled) throw new ConvexError("SETTLEMENT_CONFIGURATION_REQUIRED");
  return fingerprint({ sender: config.sender, recipients: config.recipients, network: "testnet", policy: PAYMENT_POLICY_VERSION });
}

/** Reconstruct every bound mission. No model or browser can broaden a grant. */
export async function boundMissions(ctx: QueryCtx, run: Doc<"masterRuns">) {
  if (!run.acceptedAt || !run.planJson || !run.planHash || run.cancelledAt) throw new ConvexError("MASTER_PLAN_NOT_ACTIVE");
  const checked = validatePlan(JSON.parse(run.planJson), planningContext(run));
  if (checked.plan.decision !== "execute" || await planBinding(run, checked.plan) !== run.planHash)
    throw new ConvexError("MASTER_PLAN_BINDING_CHANGED");
  if (await fingerprint(run.datasets.map(d => ({ ref: d.ref, digest: d.digest }))) !== run.datasetHash)
    throw new ConvexError("MASTER_DATASET_BINDING_CHANGED");
  for (const dataset of run.datasets) if (await fingerprint(dataset.csv) !== dataset.digest)
    throw new ConvexError("MASTER_DATASET_BINDING_CHANGED");
  const steps = await ctx.db.query("masterSteps").withIndex("by_run", q => q.eq("runId", run._id)).take(4);
  if (steps.length !== checked.missions.length) throw new ConvexError("MASTER_MISSION_BINDING_CHANGED");
  for (const [index, expected] of checked.missions.entries()) {
    const step = steps.find(s => s.stepId === checked.plan.steps[index].stepId);
    const mission = step ? await ctx.db.get(step.missionId) : null;
    if (!step || !mission || mission.ownerId !== run.ownerId || mission.contentRemovedAt !== undefined)
      throw new ConvexError("MASTER_MISSION_BINDING_CHANGED");
    const actual = { title: mission.title, serviceType: mission.serviceType, inputCsv: mission.inputCsv, options: mission.options,
      maxBudgetYocto: mission.maxBudgetYocto, deadlineAt: mission.deadlineAt, acceptanceCriteria: mission.acceptanceCriteria,
      cleanBeforeProcessing: mission.cleanBeforeProcessing, requiresHumanReview: mission.requiresHumanReview };
    if (await fingerprint(actual) !== await fingerprint(expected)) throw new ConvexError("MASTER_MISSION_BINDING_CHANGED");
    if (step.jobId) {
      const job = await ctx.db.get(step.jobId);
      if (!job || job.ownerId !== run.ownerId || job.missionId !== mission._id || job.parentId || job.depth !== 0 ||
          job.serviceType !== mission.serviceType || job.inputCsv !== mission.inputCsv ||
          await fingerprint(job.options) !== await fingerprint(mission.options) || job.budgetYocto !== mission.maxBudgetYocto ||
          job.cleanBeforeProcessing !== mission.cleanBeforeProcessing || job.requiresHumanReview !== mission.requiresHumanReview)
        throw new ConvexError("MASTER_JOB_BINDING_CHANGED");
    }
  }
  return { steps, plan: checked.plan };
}

export async function grantReason(ctx: QueryCtx, intent: Doc<"paymentIntents">): Promise<string | null> {
  if (!intent.masterGrantId) return null;
  if (!masterAutopayEnabled()) return "MASTER_AUTOPAY_DISABLED";
  if (intent.recoveryVersion === 2) return "MASTER_V2_REQUIRES_EXACT_HUMAN_APPROVAL";
  const grant = await ctx.db.get(intent.masterGrantId);
  if (!grant || grant.ownerId !== intent.ownerId || grant.revokedAt || grant.expiresAt <= Date.now()) return "MASTER_SPENDING_AUTHORIZATION_INACTIVE";
  const run = await ctx.db.get(grant.runId);
  if (!run || run.ownerId !== intent.ownerId || run.planHash !== grant.planHash || run.datasetHash !== grant.datasetHash) return "MASTER_GRANT_BINDING_CHANGED";
  try {
    if (run.startConsent && grant.startConsentHash !== run.startConsent.hash) return "START_AUTHORIZATION_CHANGED";
    if (grant.startConsentHash) {
      const consent = await checkStartConsent(run);
      if (consent.mode !== "automatic" || consent.hash !== grant.startConsentHash || consent.admittedPlanHash !== grant.planHash ||
          grant.expiresAt > consent.expiresAt || BigInt(grant.capYocto) > BigInt(consent.capYocto)) return "START_AUTHORIZATION_CHANGED";
    }
    const { steps, plan } = await boundMissions(ctx, run);
    if (grant.capYocto !== plan.proposedTotalBudgetYocto || grant.policyHash !== await policyFingerprint()) return "MASTER_GRANT_POLICY_CHANGED";
    const job = await ctx.db.get(intent.jobId);
    const root = job?.parentId ? await ctx.db.get(job.parentId) : job;
    if (!job || !root || job.ownerId !== run.ownerId || root.ownerId !== run.ownerId || root.depth !== 0 ||
        !steps.some(s => s.jobId === root._id && s.missionId === job.missionId) ||
        job.parentId && (job.depth !== 1 || !root.cleanBeforeProcessing || root.serviceType !== "csv_summary" || job.serviceType !== "csv_normalize"))
      return "MASTER_JOB_OUTSIDE_AUTHORIZATION";
    const reservations = await ctx.db.query("masterReservations").withIndex("by_grant", q => q.eq("grantId", grant._id)).take(7);
    if (reservations.length > 6 || !reservations.some(r => r.intentId === intent._id && r.amountYocto === intent.amountYocto) ||
        reservations.reduce((sum, r) => sum + BigInt(r.amountYocto), 0n) > BigInt(grant.capYocto)) return "MASTER_SPENDING_CAP_EXCEEDED";
    let totalAwards = 0n;
    for (const step of steps) if (step.jobId) {
      const contract = await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", step.jobId!)).unique();
      if (contract) {
        const rootJob = await ctx.db.get(step.jobId);
        if (!rootJob || BigInt(contract.amountYocto) > BigInt(rootJob.budgetYocto)) return "MASTER_SPENDING_CAP_EXCEEDED";
        const children = await ctx.db.query("jobs").withIndex("by_parent", q => q.eq("parentId", step.jobId!)).take(2);
        if (children.length > 1) return "MASTER_ALLOCATION_INVALID";
        const child = children[0];
        const childContract = child ? await ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", child._id)).unique() : null;
        if (child ? !rootJob.cleanBeforeProcessing || child.ownerId !== run.ownerId || child.missionId !== rootJob.missionId || child.depth !== 1 ||
          !childContract || childContract.holdbackYocto !== childContract.amountYocto ||
          BigInt(contract.holdbackYocto) + BigInt(childContract.amountYocto) !== BigInt(contract.amountYocto)
          : rootJob.cleanBeforeProcessing || contract.holdbackYocto !== contract.amountYocto) return "MASTER_ALLOCATION_INVALID";
        totalAwards += BigInt(contract.amountYocto);
      }
    }
    if (totalAwards > BigInt(grant.capYocto)) return "MASTER_SPENDING_CAP_EXCEEDED";
    return null;
  } catch { return "MASTER_GRANT_POLICY_CHANGED"; }
}

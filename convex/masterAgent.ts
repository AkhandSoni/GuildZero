import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { user } from "./ownership";
import { parseBoundedCsv } from "../lib/economy/csv-input";
import { validateBudget } from "../lib/money";
import { PAYMENT_CAP } from "../lib/settlement/policy";
import {
  compileMasterAgentPlan,
  inspectDatasetMetadata,
  parseAndValidateMasterAgentPlan,
  sha256Hex,
  type MasterAgentPlanV1,
  type PlanningPromptEnvelope,
} from "../lib/master-agent";
import { settlementReadiness } from "./settlementReadiness";
import { deliverablePreview, deliveryAccess } from "./deliveryAccess";
import { publicBid, publicContract, publicEvent, publicNegotiation } from "./publicMarket";
import { authorizeJobUnderGrant } from "./spendingGrants";
import { event } from "./workflowHelpers";

async function ownedRun(ctx: QueryCtx | MutationCtx, runId: Id<"masterAgentRuns">) {
  const ownerId = await user(ctx);
  const run = await ctx.db.get(runId);
  if (!run || run.ownerId !== ownerId) {
    throw new ConvexError("RUN_NOT_FOUND");
  }
  return run;
}

function makeRequestId(runId: string, planVersion: number, now: number): string {
  return sha256Hex(`${runId}:${planVersion}:${now}`);
}

export async function computeDerivedRunState(
  ctx: QueryCtx | MutationCtx,
  run: Doc<"masterAgentRuns">,
): Promise<Doc<"masterAgentRuns">["state"]> {
  if (
    run.state === "planning" ||
    run.state === "needs_clarification" ||
    run.state === "ready" ||
    run.state === "cancelled"
  ) {
    return run.state;
  }
  if (!run.stepRecords.length) {
    return run.state;
  }

  let anyDisputed = false;
  let anyWorkingOrBidding = false;
  let anyTerminalFailure = false;
  let allStepsApproved = true;
  let allRequiredPaymentsConfirmed = true;
  let anyPaymentUncertain = false;
  let anyPaymentFailed = false;
  let anyPaymentActive = false;

  for (const step of run.stepRecords) {
    if (!step.jobId) {
      allStepsApproved = false;
      anyWorkingOrBidding = true;
      continue;
    }
    const rootJob = await ctx.db.get(step.jobId);
    if (!rootJob) {
      anyTerminalFailure = true;
      allStepsApproved = false;
      continue;
    }
    const childJobs = await ctx.db
      .query("jobs")
      .withIndex("by_parent", (q) => q.eq("parentId", rootJob._id))
      .take(2);
    const groupJobs = [rootJob, ...childJobs];

    for (const j of groupJobs) {
      if (j.state === "disputed") anyDisputed = true;
      if (["bidding", "working", "verifying", "revision"].includes(j.state)) {
        anyWorkingOrBidding = true;
      }
      if (["rejected", "cancelled", "unawarded"].includes(j.state)) {
        anyTerminalFailure = true;
      }
      if (j.state !== "approved") {
        allStepsApproved = false;
      }
    }

    const access = await deliveryAccess(ctx, rootJob);
    if (!access.released) {
      allRequiredPaymentsConfirmed = false;
    }

    for (const j of groupJobs) {
      const intent = await ctx.db
        .query("paymentIntents")
        .withIndex("by_job", (q) => q.eq("jobId", j._id))
        .unique();
      if (intent) {
        if (intent.status === "UNKNOWN_RECONCILE") anyPaymentUncertain = true;
        if (intent.status === "FAILED") anyPaymentFailed = true;
        if (
          intent.status === "SUBMITTING" ||
          intent.status === "CONFIRMING" ||
          (intent.status === "READY" && intent.authorizedAt !== undefined)
        ) {
          anyPaymentActive = true;
        }
      }
    }
  }

  if (anyDisputed) return "needs_human_review";
  if (anyPaymentUncertain) return "payment_uncertain";
  if (anyTerminalFailure || anyPaymentFailed) return "failed";
  if (anyWorkingOrBidding) return "executing";
  if (allStepsApproved && allRequiredPaymentsConfirmed) return "completed";
  if (allStepsApproved) {
    if (anyPaymentActive) return "settling";
    const grant = run.grantId ? await ctx.db.get(run.grantId) : null;
    const grantActive =
      grant && grant.revokedAt === undefined && grant.expiresAt > Date.now();
    return grantActive ? "settling" : "awaiting_spending_authorization";
  }
  return run.state;
}

export const createRun = mutation({
  args: {
    title: v.optional(v.string()),
    prompt: v.string(),
    primaryCsv: v.string(),
    primaryName: v.optional(v.string()),
    comparisonCsv: v.optional(v.string()),
    comparisonName: v.optional(v.string()),
    maxBudgetYocto: v.string(),
    deadlineAt: v.number(),
    requiresHumanReview: v.optional(v.boolean()),
    allowUnfundedPreview: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx);
    const prompt = args.prompt.trim();
    if (!prompt || prompt.length > 2000) {
      throw new ConvexError("Prompt must contain 1–2,000 characters.");
    }
    const rawTitle = (args.title?.trim() || prompt.slice(0, 80)).trim();
    if (!rawTitle || rawTitle.length > 100) {
      throw new ConvexError("Title must contain 1–100 characters.");
    }
    try {
      validateBudget(args.maxBudgetYocto);
    } catch {
      throw new ConvexError("Budget must be positive and at most 1,000 testnet NEAR.");
    }
    if (BigInt(args.maxBudgetYocto) > PAYMENT_CAP) {
      throw new ConvexError("Master Agent automated runs are capped at 1 testnet NEAR total.");
    }
    const now = Date.now();
    if (
      !Number.isSafeInteger(args.deadlineAt) ||
      args.deadlineAt <= now ||
      args.deadlineAt > now + 30 * 86400000
    ) {
      throw new ConvexError("Deadline must be in the future, within 30 days.");
    }

    const parsedPrimary = parseBoundedCsv(args.primaryCsv);
    if (!parsedPrimary.ok) {
      throw new ConvexError(`Primary CSV: ${parsedPrimary.message}`);
    }

    const datasets: Doc<"masterAgentRuns">["datasets"] = [
      {
        ref: "d1",
        name: (args.primaryName?.trim() || "primary.csv").slice(0, 100),
        csv: args.primaryCsv,
        sha256: sha256Hex(args.primaryCsv),
        rowCount: parsedPrimary.value.rawRows.length,
        byteLength: new TextEncoder().encode(args.primaryCsv).length,
        headers: [...parsedPrimary.value.rawHeader],
      },
    ];

    if (args.comparisonCsv && args.comparisonCsv.trim().length > 0) {
      const parsedComp = parseBoundedCsv(args.comparisonCsv);
      if (!parsedComp.ok) {
        throw new ConvexError(`Comparison CSV: ${parsedComp.message}`);
      }
      datasets.push({
        ref: "d2",
        name: (args.comparisonName?.trim() || "comparison.csv").slice(0, 100),
        csv: args.comparisonCsv,
        sha256: sha256Hex(args.comparisonCsv),
        rowCount: parsedComp.value.rawRows.length,
        byteLength: new TextEncoder().encode(args.comparisonCsv).length,
        headers: [...parsedComp.value.rawHeader],
      });
    }

    const runId = await ctx.db.insert("masterAgentRuns", {
      ownerId,
      title: rawTitle,
      prompt,
      maxBudgetYocto: args.maxBudgetYocto,
      deadlineAt: args.deadlineAt,
      requiresHumanReview: args.requiresHumanReview ?? false,
      allowUnfundedPreview: args.allowUnfundedPreview ?? false,
      state: "planning",
      datasets,
      planVersion: 1,
      stepRecords: [],
      createdAt: now,
      updatedAt: now,
    });

    const activeRequestId = makeRequestId(runId, 1, now);
    await ctx.db.patch(runId, { activeRequestId });

    return { runId, requestId: activeRequestId };
  },
});

export const getPlanningContext = query({
  args: {
    runId: v.id("masterAgentRuns"),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    runId: Id<"masterAgentRuns">;
    requestId: string;
    planVersion: number;
    state: Doc<"masterAgentRuns">["state"];
    envelope: PlanningPromptEnvelope;
  }> => {
    const run = await ownedRun(ctx, args.runId);
    if (run.contentRemovedAt !== undefined) {
      throw new ConvexError("DATASET_REMOVED");
    }
    const requestId = args.requestId ?? run.activeRequestId ?? "";
    if (!requestId || (run.activeRequestId && run.activeRequestId !== requestId)) {
      throw new ConvexError("STALE_PLANNING_REQUEST");
    }
    const datasets = run.datasets.map((d) => inspectDatasetMetadata(d.ref, d.name, d.csv));
    return {
      runId: run._id,
      requestId,
      planVersion: run.planVersion,
      state: run.state,
      envelope: {
        userPrompt: run.prompt,
        ...(run.clarificationResponse ? { clarificationResponse: run.clarificationResponse } : {}),
        maxBudgetYocto: run.maxBudgetYocto,
        requiresHumanReview: run.requiresHumanReview,
        datasets,
      },
    };
  },
});

export const recordPlanResult = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
    requestId: v.string(),
    rawPlanJson: v.optional(v.string()),
    inferenceEnvelope: v.object({
      provider: v.string(),
      model: v.string(),
      modelDigest: v.optional(v.string()),
      ollamaVersion: v.optional(v.string()),
      schemaSha256: v.string(),
      promptSha256: v.string(),
      durationMs: v.number(),
      totalDurationNs: v.optional(v.number()),
      loadDurationNs: v.optional(v.number()),
      promptEvalCount: v.optional(v.number()),
      promptEvalDurationNs: v.optional(v.number()),
      evalCount: v.optional(v.number()),
      evalDurationNs: v.optional(v.number()),
      numCtx: v.optional(v.number()),
      numPredict: v.optional(v.number()),
      temperature: v.optional(v.number()),
      seed: v.optional(v.number()),
      status: v.string(),
      errorCode: v.optional(v.string()),
      sanitizedError: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.runId);
    if (run.contentRemovedAt !== undefined) {
      throw new ConvexError("DATASET_REMOVED");
    }
    // Idempotency: if this requestId was already processed, return current state without duplicating work.
    if (run.activeRequestId !== args.requestId) {
      return {
        state: run.state,
        planHash: run.planHash ?? null,
        validationError: run.validationError ?? null,
      };
    }

    const now = Date.now();
    if (args.inferenceEnvelope.status !== "ok" || !args.rawPlanJson) {
      const validationError = {
        code: args.inferenceEnvelope.errorCode ?? "INFERENCE_FAILED",
        message:
          args.inferenceEnvelope.sanitizedError ??
          "Local Ollama planning failed before returning a valid structured response.",
      };
      await ctx.db.patch(run._id, {
        state: "failed",
        inferenceEnvelope: args.inferenceEnvelope,
        validationError,
        activeRequestId: undefined,
        updatedAt: now,
      });
      return { state: "failed" as const, planHash: null, validationError };
    }

    const schemaCheck = parseAndValidateMasterAgentPlan(args.rawPlanJson);
    if (!schemaCheck.ok) {
      const validationError = {
        code: schemaCheck.code,
        message: `Schema validation failed: ${schemaCheck.message}`,
      };
      await ctx.db.patch(run._id, {
        state: "failed",
        inferenceEnvelope: args.inferenceEnvelope,
        validationError,
        latestPlanJson: undefined,
        planHash: undefined,
        activeRequestId: undefined,
        updatedAt: now,
      });
      return { state: "failed" as const, planHash: null, validationError };
    }

    const plan = schemaCheck.value;
    const compiled = compileMasterAgentPlan(plan, {
      datasets: run.datasets.map((d) => ({
        ref: d.ref,
        name: d.name,
        csv: d.csv,
        sha256: d.sha256,
      })),
      maxBudgetYocto: run.maxBudgetYocto,
      deadlineAt: run.deadlineAt,
      requiresHumanReview: run.requiresHumanReview,
      now,
    });

    if (!compiled.ok) {
      const validationError = {
        code: compiled.code,
        message: compiled.message,
      };
      await ctx.db.patch(run._id, {
        state: "failed",
        inferenceEnvelope: args.inferenceEnvelope,
        latestPlanJson: JSON.stringify(plan),
        planHash: undefined,
        validationError,
        activeRequestId: undefined,
        updatedAt: now,
      });
      return { state: "failed" as const, planHash: null, validationError };
    }

    const { planHash } = compiled.value;
    if (plan.decision === "clarify") {
      await ctx.db.patch(run._id, {
        state: "needs_clarification",
        inferenceEnvelope: args.inferenceEnvelope,
        latestPlanJson: JSON.stringify(plan),
        planHash,
        validationError: undefined,
        activeRequestId: undefined,
        updatedAt: now,
      });
      return { state: "needs_clarification" as const, planHash, validationError: null };
    }

    if (plan.decision === "unsupported") {
      const validationError = {
        code: plan.reasonCodes[0] ?? "UNSUPPORTED_OPERATION",
        message: plan.summary,
      };
      await ctx.db.patch(run._id, {
        state: "failed",
        inferenceEnvelope: args.inferenceEnvelope,
        latestPlanJson: JSON.stringify(plan),
        planHash,
        validationError,
        activeRequestId: undefined,
        updatedAt: now,
      });
      return { state: "failed" as const, planHash, validationError };
    }

    await ctx.db.patch(run._id, {
      state: "ready",
      inferenceEnvelope: args.inferenceEnvelope,
      latestPlanJson: JSON.stringify(plan),
      planHash,
      validationError: undefined,
      activeRequestId: undefined,
      updatedAt: now,
    });
    return { state: "ready" as const, planHash, validationError: null };
  },
});

export const submitClarification = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
    clarificationResponse: v.string(),
    updatedMaxBudgetYocto: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.runId);
    if (run.contentRemovedAt !== undefined) {
      throw new ConvexError("DATASET_REMOVED");
    }
    if (run.stepRecords.length > 0) {
      throw new ConvexError("RUN_ALREADY_EXECUTING");
    }
    const response = args.clarificationResponse.trim();
    if (!response || response.length > 1000) {
      throw new ConvexError("Clarification response must contain 1–1,000 characters.");
    }
    let maxBudgetYocto = run.maxBudgetYocto;
    if (args.updatedMaxBudgetYocto !== undefined) {
      validateBudget(args.updatedMaxBudgetYocto);
      if (BigInt(args.updatedMaxBudgetYocto) > PAYMENT_CAP) {
        throw new ConvexError("Master Agent automated runs are capped at 1 testnet NEAR total.");
      }
      maxBudgetYocto = args.updatedMaxBudgetYocto;
    }

    const now = Date.now();
    // Revoke any prior grant on plan revision
    if (run.grantId) {
      const g = await ctx.db.get(run.grantId);
      if (g && g.revokedAt === undefined) {
        await ctx.db.patch(g._id, { revokedAt: now });
      }
    }

    const nextVersion = run.planVersion + 1;
    const activeRequestId = makeRequestId(run._id, nextVersion, now);
    await ctx.db.patch(run._id, {
      clarificationResponse: response,
      maxBudgetYocto,
      state: "planning",
      planVersion: nextVersion,
      latestPlanJson: undefined,
      planHash: undefined,
      validationError: undefined,
      grantId: undefined,
      activeRequestId,
      updatedAt: now,
    });

    return { runId: run._id, requestId: activeRequestId, planVersion: nextVersion };
  },
});

export const retryPlanning = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
  },
  handler: async (ctx, { runId }) => {
    const run = await ownedRun(ctx, runId);
    if (run.contentRemovedAt !== undefined) {
      throw new ConvexError("DATASET_REMOVED");
    }
    if (run.stepRecords.length > 0) {
      throw new ConvexError("RUN_ALREADY_EXECUTING");
    }
    const now = Date.now();
    const nextVersion = run.planVersion + 1;
    const activeRequestId = makeRequestId(run._id, nextVersion, now);
    await ctx.db.patch(run._id, {
      state: "planning",
      planVersion: nextVersion,
      validationError: undefined,
      activeRequestId,
      updatedAt: now,
    });
    return { runId: run._id, requestId: activeRequestId, planVersion: nextVersion };
  },
});

export const acceptAndExecutePlan = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
    planVersion: v.number(),
    planHash: v.string(),
    allowUnfundedPreview: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const run = await ownedRun(ctx, args.runId);
    if (run.contentRemovedAt !== undefined) {
      throw new ConvexError("DATASET_REMOVED");
    }
    if (run.planVersion !== args.planVersion || !run.planHash || run.planHash !== args.planHash) {
      throw new ConvexError("PLAN_VERSION_MISMATCH");
    }

    // Idempotent: if already accepted/compiled for this planVersion, return existing stepRecords
    if (run.stepRecords.length > 0) {
      return {
        runId: run._id,
        stepRecords: run.stepRecords,
      };
    }

    if (run.state !== "ready" || !run.latestPlanJson) {
      throw new ConvexError("PLAN_NOT_READY_FOR_EXECUTION");
    }

    const schemaResult = parseAndValidateMasterAgentPlan(run.latestPlanJson);
    if (!schemaResult.ok || schemaResult.value.decision !== "execute") {
      throw new ConvexError("PLAN_NOT_EXECUTABLE");
    }

    const now = Date.now();
    const compiled = compileMasterAgentPlan(schemaResult.value, {
      datasets: run.datasets.map((d) => ({
        ref: d.ref,
        name: d.name,
        csv: d.csv,
        sha256: d.sha256,
      })),
      maxBudgetYocto: run.maxBudgetYocto,
      deadlineAt: run.deadlineAt,
      requiresHumanReview: run.requiresHumanReview,
      now,
    });

    if (!compiled.ok) {
      throw new ConvexError({ code: compiled.code, message: compiled.message });
    }
    if (compiled.value.planHash !== run.planHash) {
      throw new ConvexError("PLAN_HASH_MISMATCH");
    }

    const allowPreview = args.allowUnfundedPreview ?? run.allowUnfundedPreview;
    const stepRecords: Doc<"masterAgentRuns">["stepRecords"] = [];

    for (const step of compiled.value.compiledSteps) {
      const missionId = await ctx.db.insert("missions", {
        ...step.missionInput,
        ownerId: run.ownerId,
        state: "draft",
        createdAt: now,
        updatedAt: now,
      });

      const missionDoc = (await ctx.db.get(missionId))!;
      const readiness = await settlementReadiness(ctx, missionDoc);
      if (readiness.blocked && !allowPreview) {
        throw new ConvexError("SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW");
      }

      const jobId = await ctx.db.insert("jobs", {
        ownerId: run.ownerId,
        missionId,
        depth: 0,
        engineManaged: true,
        unfundedPreviewAcknowledged: allowPreview === true && readiness.blocked,
        workerVersion: 0,
        retryCount: 0,
        cleanBeforeProcessing: step.missionInput.cleanBeforeProcessing ?? false,
        requiresHumanReview: step.missionInput.requiresHumanReview ?? true,
        serviceType: step.missionInput.serviceType,
        inputCsv: step.missionInput.inputCsv,
        options: step.serviceOptions,
        budgetYocto: step.missionInput.maxBudgetYocto,
        reservedYocto: "0",
        state: "bidding",
        revisionCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.patch(missionId, { state: "active", updatedAt: now });
      const jobDoc = (await ctx.db.get(jobId))!;
      await event(
        ctx,
        jobDoc,
        "AUCTION_OPENED",
        `Master Agent step ${step.stepId} opened for independent service offers. No funds have moved.`,
      );
      if (readiness.blocked && allowPreview) {
        await event(
          ctx,
          jobDoc,
          "UNFUNDED_PREVIEW_ACKNOWLEDGED",
          "Owner acknowledged settlement is not ready. Only metadata preview is available until configured payments are confirmed.",
        );
      }
      await ctx.scheduler.runAfter(800, internal.economyWorker.step, { jobId, version: 0 });

      const planStep = schemaResult.value.steps.find((s) => s.stepId === step.stepId)!;
      stepRecords.push({
        stepId: step.stepId,
        title: step.missionInput.title,
        serviceType: step.missionInput.serviceType,
        datasetRef: step.datasetRef,
        ...(step.comparisonDatasetRef ? { comparisonDatasetRef: step.comparisonDatasetRef } : {}),
        maxBudgetYocto: step.missionInput.maxBudgetYocto,
        cleanBeforeProcessing: step.missionInput.cleanBeforeProcessing ?? false,
        requiresHumanReview: step.missionInput.requiresHumanReview ?? true,
        missionId,
        jobId,
      });
      void planStep;
    }

    await ctx.db.patch(run._id, {
      allowUnfundedPreview: allowPreview,
      stepRecords,
      state: "executing",
      updatedAt: now,
    });

    return { runId: run._id, stepRecords };
  },
});

export const authorizeEligibleStepPayments = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
  },
  handler: async (ctx, { runId }) => {
    const run = await ownedRun(ctx, runId);
    if (!run.grantId) {
      throw new ConvexError("GRANT_REQUIRED");
    }
    const grant = await ctx.db.get(run.grantId);
    if (!grant || grant.ownerId !== run.ownerId) {
      throw new ConvexError("GRANT_NOT_FOUND");
    }
    if (grant.revokedAt !== undefined) {
      throw new ConvexError("GRANT_REVOKED");
    }
    if (grant.expiresAt <= Date.now()) {
      throw new ConvexError("GRANT_EXPIRED");
    }

    const results: Array<{ jobId: Id<"jobs">; ok: boolean; code?: string; intentId?: Id<"paymentIntents"> }> = [];

    for (const step of run.stepRecords) {
      if (!step.jobId) continue;
      const rootJob = await ctx.db.get(step.jobId);
      if (!rootJob) continue;
      const children = await ctx.db
        .query("jobs")
        .withIndex("by_parent", (q) => q.eq("parentId", rootJob._id))
        .take(2);

      // Authorize child first if approved, then root job if approved
      for (const job of [...children, rootJob]) {
        if (job.state !== "approved") continue;
        const currentGrant = (await ctx.db.get(grant._id))!;
        const authRes = await authorizeJobUnderGrant(ctx, currentGrant, job);
        if (authRes.ok) {
          results.push({ jobId: job._id, ok: true, intentId: authRes.intentId });
        } else {
          results.push({ jobId: job._id, ok: false, code: authRes.code });
        }
      }
    }

    const latestRun = (await ctx.db.get(run._id))!;
    const derivedState = await computeDerivedRunState(ctx, latestRun);
    if (derivedState !== latestRun.state) {
      await ctx.db.patch(run._id, { state: derivedState, updatedAt: Date.now() });
    }

    return { results, state: derivedState };
  },
});

export const cancelRun = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
  },
  handler: async (ctx, { runId }) => {
    const run = await ownedRun(ctx, runId);
    const now = Date.now();

    if (run.grantId) {
      const grant = await ctx.db.get(run.grantId);
      if (grant && grant.revokedAt === undefined) {
        await ctx.db.patch(grant._id, { revokedAt: now });
      }
    }

    for (const step of run.stepRecords) {
      if (!step.jobId) continue;
      const rootJob = await ctx.db.get(step.jobId);
      if (rootJob && rootJob.state === "bidding") {
        await ctx.db.patch(rootJob._id, { state: "cancelled", updatedAt: now });
        await event(ctx, rootJob, "JOB_CANCELLED", "Owner cancelled Master Agent run before award.");
      }
    }

    const derived =
      run.stepRecords.length === 0
        ? "cancelled"
        : await computeDerivedRunState(ctx, (await ctx.db.get(run._id))!);
    const nextState =
      derived === "completed" || derived === "settling" || derived === "payment_uncertain"
        ? derived
        : "cancelled";
    await ctx.db.patch(run._id, {
      state: nextState,
      activeRequestId: undefined,
      updatedAt: now,
    });
    return { state: nextState };
  },
});

export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await user(ctx);
    const runs = await ctx.db
      .query("masterAgentRuns")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(25);

    return Promise.all(
      runs.map(async (run) => {
        const derivedState = await computeDerivedRunState(ctx, run);
        return {
          _id: run._id,
          title: run.title,
          prompt: run.prompt,
          state: derivedState,
          maxBudgetYocto: run.maxBudgetYocto,
          deadlineAt: run.deadlineAt,
          planVersion: run.planVersion,
          stepCount: run.stepRecords.length,
          hasGrant: Boolean(run.grantId),
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        };
      }),
    );
  },
});

export const getRun = query({
  args: {
    runId: v.id("masterAgentRuns"),
  },
  handler: async (ctx, { runId }) => {
    const run = await ownedRun(ctx, runId);
    const derivedState = await computeDerivedRunState(ctx, run);

    let parsedPlan: MasterAgentPlanV1 | null = null;
    if (run.latestPlanJson) {
      const check = parseAndValidateMasterAgentPlan(run.latestPlanJson);
      if (check.ok) parsedPlan = check.value;
    }

    const grant = run.grantId ? await ctx.db.get(run.grantId) : null;
    const grantReservations = grant
      ? await ctx.db
          .query("grantReservations")
          .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
          .take(20)
      : [];

    const stepsDetailed = await Promise.all(
      run.stepRecords.map(async (step) => {
        const mission = await ctx.db.get(step.missionId);
        const rootJob = step.jobId ? await ctx.db.get(step.jobId) : null;
        if (!rootJob) {
          return {
            step,
            mission,
            jobDetail: null,
            childPayment: null,
            rootPayment: null,
          };
        }

        const [
          bids,
          negotiations,
          contracts,
          deliverables,
          verifications,
          children,
          disputes,
          events,
          rootPayment,
        ] = await Promise.all([
          ctx.db.query("bids").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).take(10),
          ctx.db.query("negotiations").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).take(30),
          ctx.db.query("contracts").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).take(1),
          ctx.db.query("deliverables").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).take(2),
          ctx.db.query("verifications").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).take(2),
          ctx.db.query("jobs").withIndex("by_parent", (q) => q.eq("parentId", rootJob._id)).take(1),
          ctx.db.query("disputes").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).take(1),
          ctx.db
            .query("economyEvents")
            .withIndex("by_job", (q) => q.eq("jobId", rootJob._id))
            .order("desc")
            .take(50),
          ctx.db.query("paymentIntents").withIndex("by_job", (q) => q.eq("jobId", rootJob._id)).unique(),
        ]);

        const childJob = children[0] ?? null;
        const childPayment = childJob
          ? await ctx.db.query("paymentIntents").withIndex("by_job", (q) => q.eq("jobId", childJob._id)).unique()
          : null;
        const childContract = childJob
          ? await ctx.db.query("contracts").withIndex("by_job", (q) => q.eq("jobId", childJob._id)).unique()
          : null;

        const access = await deliveryAccess(ctx, rootJob);
        const latest =
          access.obligations.find((row) => row.job._id === rootJob._id)?.deliverable ??
          (await ctx.db
            .query("deliverables")
            .withIndex("by_job", (q) => q.eq("jobId", rootJob._id))
            .order("desc")
            .first());

        return {
          step,
          mission,
          rootPayment,
          childPayment,
          childContract: childContract ? publicContract(childContract) : null,
          jobDetail: {
            delivery: {
              released: access.released,
              reason: access.reason,
              requiredPayments: access.obligations.length,
              confirmedPayments: access.obligations.filter((row) => row.confirmed).length,
            },
            job: rootJob,
            bids: bids.map(publicBid),
            negotiations: negotiations.map(publicNegotiation),
            contracts: contracts.map(publicContract),
            deliverables: deliverables.map((d) => ({
              _id: d._id,
              _creationTime: d._creationTime,
              jobId: d.jobId,
              attempt: d.attempt,
              format: d.format,
              isLatest: d._id === latest?._id,
              preview: deliverablePreview(d),
              content: access.released && d._id === latest?._id ? d.content : null,
              createdAt: d.createdAt,
              dependencyDeliverableId: d.dependencyDeliverableId ?? null,
            })),
            verifications,
            children,
            disputes,
            events: events.map(publicEvent),
          },
        };
      }),
    );

    return {
      run: {
        ...run,
        state: derivedState,
        datasets: run.datasets.map((d) => ({
          ref: d.ref,
          name: d.name,
          sha256: d.sha256,
          rowCount: d.rowCount,
          byteLength: d.byteLength,
          headers: d.headers,
        })),
      },
      plan: parsedPlan,
      grant: grant
        ? {
            ...grant,
            isExpired: grant.expiresAt <= Date.now(),
            isRevoked: grant.revokedAt !== undefined,
          }
        : null,
      grantReservations,
      steps: stepsDetailed,
    };
  },
});

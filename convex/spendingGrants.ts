import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { user } from "./ownership";
import { audit, bindingReason, PAYMENT_POLICY_VERSION, quote } from "./paymentHelpers";
import { authorizeAllowance } from "./allowanceHelpers";
import { appendAttempt, currentAttempt, recoveryEnabled } from "./paymentRecoveryHelpers";
import { configuration, PAYMENT_CAP, testnetAccount } from "../lib/settlement/policy";
import { canonicalJson, sha256Hex } from "../lib/master-agent/schema";
import { event } from "./workflowHelpers";

export const OPERATOR_GAS_RESERVE_YOCTO = (10n ** 22n).toString(); // 0.01 NEAR gas reserve disclosure
export const DEFAULT_GRANT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_GRANT_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const POSITIVE_YOCTO_RE = /^[1-9]\d{0,27}$/;

export function currentRecipientsHash(): {
  sender: string;
  recipientsHash: string;
  enabled: boolean;
} {
  const cfg = configuration();
  return {
    sender: cfg.sender,
    recipientsHash: sha256Hex(canonicalJson(cfg.recipients)),
    enabled: cfg.enabled,
  };
}

export async function verifyGrantBindingAndCapacity(
  ctx: QueryCtx | MutationCtx,
  grant: Doc<"spendingGrants">,
  job: Doc<"jobs">,
  expectedAmountYocto: string,
  existingReservationForIntent?: Doc<"grantReservations"> | null,
): Promise<{
  ok: true;
  run: Doc<"masterAgentRuns">;
  rootJob: Doc<"jobs">;
} | {
  ok: false;
  code: string;
}> {
  const now = Date.now();
  if (grant.revokedAt !== undefined) {
    return { ok: false, code: "GRANT_REVOKED" };
  }
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now) {
    return { ok: false, code: "GRANT_EXPIRED" };
  }
  if (grant.ownerId !== job.ownerId) {
    return { ok: false, code: "GRANT_OWNER_MISMATCH" };
  }
  if (job.contentRemovedAt !== undefined) {
    return { ok: false, code: "DATASET_REMOVED" };
  }

  const run = await ctx.db.get(grant.runId);
  if (!run || run.ownerId !== grant.ownerId || run.contentRemovedAt !== undefined) {
    return { ok: false, code: "GRANT_RUN_INVALID" };
  }
  if (
    run.planVersion !== grant.planVersion ||
    !run.planHash ||
    run.planHash !== grant.planHash ||
    run.grantId !== grant._id
  ) {
    return { ok: false, code: "GRANT_PLAN_CHANGED" };
  }

  const currentDatasetDigests = run.datasets.map((d) => `${d.ref}:${d.sha256}`);
  if (JSON.stringify(currentDatasetDigests) !== JSON.stringify(grant.datasetDigests)) {
    return { ok: false, code: "GRANT_DATASET_CHANGED" };
  }

  const rootJob = job.parentId ? await ctx.db.get(job.parentId) : job;
  if (
    !rootJob ||
    rootJob.parentId ||
    rootJob.depth !== 0 ||
    rootJob.ownerId !== grant.ownerId ||
    rootJob.missionId !== job.missionId
  ) {
    return { ok: false, code: "GRANT_JOB_STRUCTURE_INVALID" };
  }

  const scope = grant.allowedScopes.find((s) => s.missionId === rootJob.missionId);
  if (!scope || !grant.missionIds.includes(rootJob.missionId)) {
    return { ok: false, code: "GRANT_MISSION_OUT_OF_SCOPE" };
  }
  if (rootJob.serviceType !== scope.serviceType) {
    return { ok: false, code: "GRANT_SERVICE_SCOPE_MISMATCH" };
  }
  if (job.depth === 1) {
    if (!scope.cleanBeforeProcessing || !rootJob.cleanBeforeProcessing || job.serviceType !== "csv_normalize") {
      return { ok: false, code: "GRANT_SUBCONTRACT_NOT_PERMITTED" };
    }
  }

  let policySnap: ReturnType<typeof currentRecipientsHash>;
  try {
    policySnap = currentRecipientsHash();
  } catch {
    return { ok: false, code: "SETTLEMENT_CONFIGURATION_REQUIRED" };
  }
  if (!policySnap.enabled || !testnetAccount(policySnap.sender)) {
    return { ok: false, code: "SETTLEMENT_CONFIGURATION_REQUIRED" };
  }
  if (
    grant.operatorAccount !== policySnap.sender ||
    grant.recipientsHash !== policySnap.recipientsHash ||
    grant.policyVersion !== PAYMENT_POLICY_VERSION
  ) {
    return { ok: false, code: "GRANT_POLICY_CHANGED" };
  }

  if (!POSITIVE_YOCTO_RE.test(expectedAmountYocto) || !POSITIVE_YOCTO_RE.test(grant.maxTransferYocto)) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }
  const amount = BigInt(expectedAmountYocto);
  const maxTransfer = BigInt(grant.maxTransferYocto);
  const stepCap = BigInt(scope.stepCapYocto);

  if (amount <= 0n || amount > PAYMENT_CAP || maxTransfer > PAYMENT_CAP) {
    return { ok: false, code: "PAYMENT_CAP" };
  }

  // Verify parent + child conservation on root contract
  const rootContract = await ctx.db
    .query("contracts")
    .withIndex("by_job", (q) => q.eq("jobId", rootJob._id))
    .unique();
  if (!rootContract || rootContract.state !== "completed") {
    return { ok: false, code: "CONTRACT_NOT_COMPLETED" };
  }
  const rootAward = BigInt(rootContract.amountYocto);
  if (rootAward > stepCap || rootAward > maxTransfer) {
    return { ok: false, code: "GRANT_CAP_EXCEEDED" };
  }

  if (job.depth === 1) {
    const childContract = await ctx.db
      .query("contracts")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .unique();
    if (
      !childContract ||
      childContract.state !== "completed" ||
      BigInt(rootContract.holdbackYocto) + BigInt(childContract.amountYocto) !== rootAward
    ) {
      return { ok: false, code: "GRANT_ALLOCATION_MISMATCH" };
    }
  }

  // Sum all existing reservations across the grant, excluding the current intent's own reservation if already linked.
  const reservations = await ctx.db
    .query("grantReservations")
    .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
    .take(20);

  let totalReserved = 0n;
  let stepReserved = 0n;
  for (const res of reservations) {
    if (existingReservationForIntent && res._id === existingReservationForIntent._id) {
      continue;
    }
    const rAmount = BigInt(res.amountYocto);
    totalReserved += rAmount;
    if (res.missionId === rootJob.missionId) {
      stepReserved += rAmount;
    }
  }

  if (stepReserved + amount > stepCap || stepReserved + amount > rootAward) {
    return { ok: false, code: "GRANT_STEP_CAP_EXCEEDED" };
  }
  if (totalReserved + amount > maxTransfer) {
    return { ok: false, code: "GRANT_CAP_EXCEEDED" };
  }

  return { ok: true, run, rootJob };
}

/**
 * Rechecks grant validity at the signer claim/permit boundary (`paymentWorker.claim` and `paymentRecoveryWorker.claim` / `signingPermit`).
 */
export async function verifyGrantAtClaimBoundary(
  ctx: QueryCtx | MutationCtx,
  intent: Doc<"paymentIntents">,
  job: Doc<"jobs">,
): Promise<string | null> {
  if (!intent.grantId) return null;
  const grant = await ctx.db.get(intent.grantId);
  if (!grant) return "GRANT_NOT_FOUND";
  const reservation = await ctx.db
    .query("grantReservations")
    .withIndex("by_intent", (q) => q.eq("intentId", intent._id))
    .unique();
  if (
    !reservation ||
    reservation.grantId !== grant._id ||
    reservation.jobId !== job._id ||
    reservation.ownerId !== intent.ownerId ||
    reservation.amountYocto !== intent.amountYocto
  ) {
    return "GRANT_RESERVATION_MISSING";
  }
  const check = await verifyGrantBindingAndCapacity(ctx, grant, job, intent.amountYocto, reservation);
  if (!check.ok) return check.code;
  return null;
}

/**
 * Authorizes an eligible approved job's exact payment intent under an active human grant.
 * Never skips `quote`, `bindingReason`, or optional operator allowances.
 */
export async function authorizeJobUnderGrant(
  ctx: MutationCtx,
  grant: Doc<"spendingGrants">,
  job: Doc<"jobs">,
): Promise<{ ok: true; intentId: Id<"paymentIntents"> } | { ok: false; code: string }> {
  let q: Awaited<ReturnType<typeof quote>>;
  try {
    q = await quote(ctx, job);
  } catch (error) {
    const code =
      error instanceof ConvexError && typeof error.data === "string"
        ? error.data
        : "PAYMENT_CONFIGURATION_OR_POLICY";
    await audit(ctx, job, "GRANT_AUTHORIZE_PAYMENT", code);
    return { ok: false, code };
  }

  let intent = await ctx.db
    .query("paymentIntents")
    .withIndex("by_job", ( idx ) => idx.eq("jobId", job._id))
    .unique();

  if (!intent) {
    const intentId = await ctx.db.insert("paymentIntents", {
      grantId: grant._id,
      ...(recoveryEnabled() ? { recoveryVersion: 2 as const } : {}),
      ownerId: job.ownerId,
      jobId: job._id,
      contractId: q.contract._id,
      policyVersion: q.policyVersion,
      deliverableId: q.deliverableId,
      verificationId: q.verificationId,
      ...(q.disputeId ? { disputeId: q.disputeId } : {}),
      sender: q.sender,
      recipient: q.recipient,
      amountYocto: q.amountYocto,
      network: "testnet",
      status: "READY",
      createdAt: Date.now(),
    });
    if (recoveryEnabled()) {
      const attemptId = await appendAttempt(ctx, (await ctx.db.get(intentId))!, 1);
      await ctx.db.patch(intentId, { currentAttemptId: attemptId, attemptCount: 1 });
    }
    await audit(ctx, job, "PREPARE_PAYMENT", "EXACT_TRANSFER_PREPARED", "allow");
    intent = (await ctx.db.get(intentId))!;
  }

  // If already confirmed, submitting, confirming, or uncertain, do not re-authorize or double-reserve.
  if (intent.status !== "READY") {
    return { ok: false, code: "DUPLICATE_OR_UNCERTAIN_PAYMENT" };
  }
  if (intent.authorizedAt !== undefined) {
    await audit(ctx, job, "GRANT_AUTHORIZE_PAYMENT", "ALREADY_AUTHORIZED");
    return { ok: false, code: "ALREADY_AUTHORIZED" };
  }

  // Note: A human grant is NOT the separate current-attempt confirmation required by the gated retry protocol.
  if (intent.recoveryVersion === 2 && (intent.attemptCount ?? 1) > 1) {
    await audit(ctx, job, "GRANT_AUTHORIZE_PAYMENT", "RETRY_REQUIRES_DIRECT_HUMAN_CONFIRMATION");
    return { ok: false, code: "RETRY_REQUIRES_DIRECT_HUMAN_CONFIRMATION" };
  }

  const bindErr = bindingReason(intent, q);
  if (bindErr) {
    await audit(ctx, job, "GRANT_AUTHORIZE_PAYMENT", bindErr);
    return { ok: false, code: bindErr };
  }

  const existingReservation = await ctx.db
    .query("grantReservations")
    .withIndex("by_job", (idx) => idx.eq("jobId", job._id))
    .unique();

  const grantCheck = await verifyGrantBindingAndCapacity(
    ctx,
    grant,
    job,
    intent.amountYocto,
    existingReservation,
  );
  if (!grantCheck.ok) {
    await audit(ctx, job, "GRANT_AUTHORIZE_PAYMENT", grantCheck.code);
    return { ok: false, code: grantCheck.code };
  }

  try {
    await authorizeAllowance(ctx, intent);
  } catch (error) {
    const code =
      error instanceof ConvexError ? String(error.data) : "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED";
    await audit(ctx, job, "GRANT_AUTHORIZE_PAYMENT", code);
    return { ok: false, code };
  }

  if (!existingReservation) {
    await ctx.db.insert("grantReservations", {
      grantId: grant._id,
      ownerId: grant.ownerId,
      runId: grant.runId,
      missionId: grantCheck.rootJob.missionId,
      rootJobId: grantCheck.rootJob._id,
      jobId: job._id,
      intentId: intent._id,
      amountYocto: intent.amountYocto,
      createdAt: Date.now(),
    });
    const newReserved = (BigInt(grant.reservedYocto) + BigInt(intent.amountYocto)).toString();
    await ctx.db.patch(grant._id, { reservedYocto: newReserved });
  } else if (existingReservation.grantId !== grant._id) {
    await ctx.db.patch(existingReservation._id, { grantId: grant._id });
    const newReserved = (BigInt(grant.reservedYocto) + BigInt(intent.amountYocto)).toString();
    await ctx.db.patch(grant._id, { reservedYocto: newReserved });
  }

  const authorizedAt = Date.now();
  await ctx.db.patch(intent._id, { grantId: grant._id, authorizedAt });
  const attempt = intent.recoveryVersion === 2 ? await currentAttempt(ctx, intent) : null;
  if (attempt) {
    await ctx.db.patch(attempt._id, { grantId: grant._id, authorizedAt });
  }

  await audit(
    ctx,
    job,
    "GRANT_AUTHORIZE_PAYMENT",
    `GRANT_APPROVED:${grant._id}`,
    "allow",
  );
  await event(
    ctx,
    job,
    "GRANT_PAYMENT_AUTHORIZED",
    `Scoped human spending grant authorized exact transfer of ${intent.amountYocto} yoctoNEAR to ${intent.recipient}.`,
  );

  if (attempt) {
    await ctx.scheduler.runAfter(0, internal.nearRecovery.settle, { attemptId: attempt._id });
  } else {
    await ctx.scheduler.runAfter(0, internal.nearSettlement.settle, { intentId: intent._id });
  }

  return { ok: true, intentId: intent._id };
}

export const create = mutation({
  args: {
    runId: v.id("masterAgentRuns"),
    planVersion: v.number(),
    planHash: v.string(),
    maxTransferYocto: v.string(),
    expiresInMs: v.optional(v.number()),
    confirm: v.literal("AUTHORIZE_SCOPED_RUN_SPENDING"),
  },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== ownerId) {
      throw new ConvexError("RUN_NOT_FOUND");
    }
    if (run.contentRemovedAt !== undefined) {
      throw new ConvexError("DATASET_REMOVED");
    }
    if (!run.stepRecords.length) {
      throw new ConvexError("ACCEPT_PLAN_BEFORE_GRANT");
    }
    if (run.planVersion !== args.planVersion || !run.planHash || run.planHash !== args.planHash) {
      throw new ConvexError("GRANT_PLAN_CHANGED");
    }
    if (!POSITIVE_YOCTO_RE.test(args.maxTransferYocto)) {
      throw new ConvexError("INVALID_AMOUNT");
    }
    const maxTransfer = BigInt(args.maxTransferYocto);
    if (maxTransfer <= 0n || maxTransfer > PAYMENT_CAP || maxTransfer > BigInt(run.maxBudgetYocto)) {
      throw new ConvexError("GRANT_CAP_EXCEEDS_ALLOWED_LIMIT");
    }

    const totalStepBudgets = run.stepRecords.reduce(
      (acc, s) => acc + BigInt(s.maxBudgetYocto),
      0n,
    );
    if (maxTransfer < totalStepBudgets) {
      throw new ConvexError("GRANT_CAP_BELOW_STEP_BUDGETS");
    }

    let policySnap: ReturnType<typeof currentRecipientsHash>;
    try {
      policySnap = currentRecipientsHash();
    } catch {
      throw new ConvexError("SETTLEMENT_CONFIGURATION_REQUIRED");
    }
    if (!policySnap.enabled || !testnetAccount(policySnap.sender)) {
      throw new ConvexError("SETTLEMENT_CONFIGURATION_REQUIRED");
    }

    // Revoke any prior active grant for this run before issuing a fresh one,
    // and carry over only claimed/pending/uncertain/confirmed obligations.
    const existingGrants = await ctx.db
      .query("spendingGrants")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(10);
    let carriedReserved = 0n;
    const now = Date.now();
    for (const prev of existingGrants) {
      if (prev.revokedAt === undefined) {
        await ctx.db.patch(prev._id, { revokedAt: now });
      }
      const prevReservations = await ctx.db
        .query("grantReservations")
        .withIndex("by_grant", (q) => q.eq("grantId", prev._id))
        .take(20);
      for (const res of prevReservations) {
        const intent = await ctx.db.get(res.intentId);
        if (intent && intent.status !== "READY") {
          carriedReserved += BigInt(res.amountYocto);
        }
      }
    }
    if (carriedReserved > maxTransfer) {
      throw new ConvexError("GRANT_CAP_BELOW_EXISTING_OBLIGATIONS");
    }

    const durationMs = Math.max(
      60_000,
      Math.min(args.expiresInMs ?? DEFAULT_GRANT_DURATION_MS, MAX_GRANT_DURATION_MS),
    );
    const datasetDigests = run.datasets.map((d) => `${d.ref}:${d.sha256}`);
    const missionIds = run.stepRecords.map((s) => s.missionId);
    const allowedScopes = run.stepRecords.map((s) => ({
      missionId: s.missionId,
      serviceType: s.serviceType,
      cleanBeforeProcessing: s.cleanBeforeProcessing,
      stepCapYocto: s.maxBudgetYocto,
    }));

    const grantId = await ctx.db.insert("spendingGrants", {
      ownerId,
      runId: run._id,
      planVersion: run.planVersion,
      planHash: run.planHash,
      datasetDigests,
      missionIds,
      allowedScopes,
      operatorAccount: policySnap.sender,
      recipientsHash: policySnap.recipientsHash,
      policyVersion: PAYMENT_POLICY_VERSION,
      maxTransferYocto: args.maxTransferYocto,
      reservedYocto: carriedReserved.toString(),
      gasReserveDisclosureYocto: OPERATOR_GAS_RESERVE_YOCTO,
      expiresAt: now + durationMs,
      createdAt: now,
    });

    await ctx.db.patch(run._id, { grantId, updatedAt: now });

    // Record audit on each bound root job
    for (const step of run.stepRecords) {
      if (step.jobId) {
        const rootJob = await ctx.db.get(step.jobId);
        if (rootJob) {
          await audit(
            ctx,
            rootJob,
            "human_grant_created",
            `SCOPED_GRANT_CREATED:${grantId}:CAP_${args.maxTransferYocto}`,
            "allow",
          );
          await event(
            ctx,
            rootJob,
            "HUMAN_GRANT_CREATED",
            `Owner created scoped spending grant (max transfer ${args.maxTransferYocto} yoctoNEAR; separate operator gas reserve ${OPERATOR_GAS_RESERVE_YOCTO} yoctoNEAR).`,
          );
        }
      }
    }

    return grantId;
  },
});

export const revoke = mutation({
  args: {
    grantId: v.id("spendingGrants"),
  },
  handler: async (ctx, { grantId }) => {
    const ownerId = await user(ctx);
    const grant = await ctx.db.get(grantId);
    if (!grant || grant.ownerId !== ownerId) {
      throw new ConvexError("GRANT_NOT_FOUND");
    }
    if (grant.revokedAt !== undefined) {
      return { revokedAt: grant.revokedAt };
    }
    const now = Date.now();
    await ctx.db.patch(grantId, { revokedAt: now });

    // Clear un-claimed READY authorizations bound to this grant; retain claimed/broadcast/uncertain reservations.
    const reservations = await ctx.db
      .query("grantReservations")
      .withIndex("by_grant", (q) => q.eq("grantId", grantId))
      .take(20);
    let releasedReady = 0n;
    for (const res of reservations) {
      const intent = await ctx.db.get(res.intentId);
      if (intent && intent.status === "READY") {
        if (intent.authorizedAt !== undefined) {
          await ctx.db.patch(intent._id, {
            authorizedAt: undefined,
            lastReason: "GRANT_REVOKED",
          });
        }
        if (intent.currentAttemptId) {
          const att = await ctx.db.get(intent.currentAttemptId);
          if (att && att.phase === "READY") {
            await ctx.db.patch(att._id, { authorizedAt: undefined, lastReason: "GRANT_REVOKED" });
          }
        }
        releasedReady += BigInt(res.amountYocto);
        await ctx.db.delete(res._id);
      }
    }
    if (releasedReady > 0n) {
      const currentReserved = BigInt(grant.reservedYocto);
      const remaining = currentReserved > releasedReady ? currentReserved - releasedReady : 0n;
      await ctx.db.patch(grantId, { reservedYocto: remaining.toString() });
    }

    const run = await ctx.db.get(grant.runId);
    if (run) {
      for (const step of run.stepRecords) {
        if (step.jobId) {
          const rootJob = await ctx.db.get(step.jobId);
          if (rootJob) {
            await audit(ctx, rootJob, "HUMAN_GRANT_REVOKED", `GRANT_REVOKED:${grantId}`, "allow");
            await event(
              ctx,
              rootJob,
              "HUMAN_GRANT_REVOKED",
              "Owner revoked scoped spending grant. New payment claims are blocked; any already broadcast transfer cannot be cancelled.",
            );
          }
        }
      }
    }

    return { revokedAt: now };
  },
});

export const forRun = query({
  args: { runId: v.id("masterAgentRuns") },
  handler: async (ctx, { runId }) => {
    const ownerId = await user(ctx);
    const run = await ctx.db.get(runId);
    if (!run || run.ownerId !== ownerId) {
      throw new ConvexError("RUN_NOT_FOUND");
    }
    const grant = run.grantId ? await ctx.db.get(run.grantId) : null;
    if (!grant || grant.ownerId !== ownerId) return null;
    const reservations = await ctx.db
      .query("grantReservations")
      .withIndex("by_grant", (q) => q.eq("grantId", grant._id))
      .take(20);
    return {
      grant,
      reservations,
    };
  },
});

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { configuration, testnetAccount, yocto } from "../lib/settlement/policy";
export const PAYMENT_POLICY_VERSION = "guildzero-testnet-v1";
export async function audit(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  scenario: string,
  reason: string,
  decision: "allow" | "reject" = "reject",
) {
  await ctx.db.insert("securityEvents", {
    ownerId: job.ownerId,
    jobId: job._id,
    scenario,
    decision,
    reason,
    createdAt: Date.now(),
  });
}
export async function quote(ctx: MutationCtx, job: Doc<"jobs">) {
  if (job.contentRemovedAt !== undefined) throw new ConvexError("DATASET_REMOVED");
  if (job.state !== "approved") throw new ConvexError("WORK_NOT_APPROVED");
  if (job.parentId) {
    const parent = await ctx.db.get(job.parentId);
    if (parent?.state !== "approved")
      throw new ConvexError("PARENT_NOT_APPROVED");
  }
  const contract = await ctx.db
    .query("contracts")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .unique();
  if (!contract || contract.state !== "completed")
    throw new ConvexError("CONTRACT_NOT_COMPLETED");
  const deliverable = await ctx.db
    .query("deliverables")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .order("desc")
    .first();
  const verification = deliverable
    ? await ctx.db
        .query("verifications")
        .withIndex("by_deliverable", (q) =>
          q.eq("deliverableId", deliverable._id),
        )
        .unique()
    : null;
  const dispute = await ctx.db
    .query("disputes")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .unique();
  if (
    !deliverable ||
    !verification ||
    verification.jobId !== job._id ||
    (verification.verdict !== "pass" && dispute?.decision !== "approve")
  )
    throw new ConvexError("VERIFICATION_OR_BUYER_APPROVAL_REQUIRED");
  if (verification.verdict !== "pass" &&
      (dispute?.decidedBy !== job.ownerId || !Number.isSafeInteger(dispute.decidedAt)))
    throw new ConvexError("VERIFICATION_OR_BUYER_APPROVAL_REQUIRED");
  const config = configuration(),
    recipient = config.recipients[contract.agentId];
  if (
    !testnetAccount(config.sender) ||
    typeof recipient !== "string" ||
    !testnetAccount(recipient) ||
    recipient === config.sender
  )
    throw new ConvexError("TESTNET_RECIPIENT_CONFIGURATION_REQUIRED");
  const amount = yocto(contract.holdbackYocto);
  if (
    amount > BigInt(job.reservedYocto) ||
    amount > BigInt(contract.amountYocto)
  )
    throw new ConvexError("PAYMENT_EXCEEDS_RESERVATION");
  return {
    policyVersion: PAYMENT_POLICY_VERSION,
    deliverableId: deliverable._id,
    verificationId: verification._id,
    ...(verification.verdict !== "pass" && dispute ? { disputeId: dispute._id } : {}),
    contract,
    recipient,
    sender: config.sender,
    amountYocto: amount.toString(),
  };
}

/** Recheck the exact immutable approval snapshot before authorization/claim. */
export function bindingReason(
  intent: Doc<"paymentIntents">,
  current: Awaited<ReturnType<typeof quote>>,
): string | null {
  if (intent.policyVersion !== PAYMENT_POLICY_VERSION ||
      !intent.deliverableId || !intent.verificationId)
    return "PAYMENT_APPROVAL_BINDING_REQUIRED";
  if (intent.contractId !== current.contract._id ||
      intent.deliverableId !== current.deliverableId ||
      intent.verificationId !== current.verificationId ||
      intent.disputeId !== current.disputeId)
    return "PAYMENT_APPROVAL_CHANGED";
  if (intent.sender !== current.sender || intent.recipient !== current.recipient ||
      intent.amountYocto !== current.amountYocto)
    return "PAYMENT_POLICY_CHANGED";
  return null;
}

import { appendAttempt, recoveryEnabled } from "./paymentRecoveryHelpers";


/** Shared preparation; callers must establish ownership/authority before entry. */
export async function prepareIntent(ctx: MutationCtx, job: Doc<"jobs">) {
    const old = await ctx.db
      .query("paymentIntents")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .unique();
    if (old) return { ok: true as const, intentId: old._id };
    let q: Awaited<ReturnType<typeof quote>>;
    try { q = await quote(ctx, job); }
    catch (error) {
      const code = error instanceof ConvexError ? String(error.data) : "PAYMENT_CONFIGURATION_OR_POLICY";
      await audit(ctx, job, "PREPARE_PAYMENT", code);
      return { ok: false as const, code };
    }
    // Once writes begin, let failures abort the entire mutation. In particular,
    // an attempt write must not leave an orphaned stable intent behind.
    const intentId = await ctx.db.insert("paymentIntents", {
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
    await audit(
      ctx,
      job,
      "PREPARE_PAYMENT",
      "EXACT_TRANSFER_PREPARED",
      "allow",
    );
    return { ok: true as const, intentId };
}

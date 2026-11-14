import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { deliveryAccess } from "./deliveryAccess";
import { prepareIntent, quote, bindingReason, audit } from "./paymentHelpers";
import { authorizeAllowance } from "./allowanceHelpers";
import { boundMissions, masterEvent, masterAutopayEnabled, grantReason } from "./masterHelpers";

export const authorize = internalMutation({ args: { grantId: v.id("masterGrants"), jobId: v.id("jobs") }, handler: async (ctx, args): Promise<void> => {
  const grant = await ctx.db.get(args.grantId), job = await ctx.db.get(args.jobId);
  if (!grant || !job || grant.ownerId !== job.ownerId) throw new ConvexError("MASTER_GRANT_BINDING_CHANGED");
  const prepared = await prepareIntent(ctx, job);
  if (!prepared.ok) throw new ConvexError(prepared.code);
  const intent = (await ctx.db.get(prepared.intentId))!;
  if (intent.status !== "READY" || intent.authorizedAt || intent.recoveryVersion === 2 || intent.masterSigningAdmittedAt)
    throw new ConvexError("MASTER_EXACT_HUMAN_APPROVAL_REQUIRED");
  if ((await ctx.db.query("masterReservations").withIndex("by_intent", q => q.eq("intentId", intent._id)).take(1)).length)
    throw new ConvexError("MASTER_AUTHORIZATION_ALREADY_ATTEMPTED");
  const current = await quote(ctx, job);
  const changed = bindingReason(intent, current);
  if (changed) throw new ConvexError(changed);
  await authorizeAllowance(ctx, intent);
  await ctx.db.insert("masterReservations", { grantId: grant._id, intentId: intent._id, amountYocto: intent.amountYocto, createdAt: Date.now() });
  await ctx.db.patch(intent._id, { masterGrantId: grant._id });
  const reason = await grantReason(ctx, (await ctx.db.get(intent._id))!);
  if (reason) throw new ConvexError(reason); // Abort all reservation/preparation writes.
  await ctx.db.patch(intent._id, { authorizedAt: Date.now() });
  await audit(ctx, job, "AUTHORIZE_PAYMENT_UNDER_HUMAN_GRANT", "EXACT_BOUND_TRANSFER_WITHIN_AUTHORIZED_MISSIONS", "allow");
  await ctx.scheduler.runAfter(0, internal.nearSettlement.settle, { intentId: intent._id });
} });

export const step = internalMutation({ args: { runId: v.id("masterRuns") }, handler: async (ctx, { runId }): Promise<void> => {
  const run = await ctx.db.get(runId);
  if (!run || !run.acceptedAt || run.cancelledAt) return;
  const setState = async (state: string, error?: string) => {
    if (run.state !== state || run.error !== error) {
      await ctx.db.patch(runId, { state, error, updatedAt: Date.now() });
      await masterEvent(ctx, run, "WORKFLOW_STATE", state.replaceAll("_", " ") + (error ? ": " + error : ""));
    }
  };
  const steps = await ctx.db.query("masterSteps").withIndex("by_run", q => q.eq("runId", runId)).take(4);
  if (!steps.length || steps.length > 3) { await setState("failed", "MASTER_STEP_STRUCTURE_INVALID"); return; }
  const roots = await Promise.all(steps.map(s => s.jobId ? ctx.db.get(s.jobId) : null));
  if (roots.some(j => !j || j.ownerId !== run.ownerId)) { await setState("failed", "MASTER_JOB_BINDING_CHANGED"); return; }
  if (roots.some(j => ["rejected", "unawarded", "cancelled"].includes(j!.state))) { await setState("failed", "A_SERVICE_DID_NOT_COMPLETE"); return; }
  if (roots.some(j => j!.state === "disputed")) { await setState("needs_human_review"); return; }
  if (roots.some(j => j!.state !== "approved")) { await setState("executing"); return; }
  const access = await Promise.all(roots.map(j => deliveryAccess(ctx, j!)));
  if (access.every(a => a.released)) { await setState("completed"); return; }
  const obligations = access.flatMap(a => a.obligations);
  if (obligations.some(o => o.payment?.status === "UNKNOWN_RECONCILE")) { await setState("payment_uncertain", "CHECK_ORIGINAL_TRANSACTION_IN_MISSION"); return; }
  if (obligations.some(o => o.payment?.status === "FAILED")) { await setState("failed", "PAYMENT_FAILED_MANUAL_REVIEW"); return; }
  if (obligations.some(o => ["SUBMITTING", "CONFIRMING"].includes(o.payment?.status ?? "") || o.payment?.status === "READY" && o.payment.authorizedAt)) {
    await setState("settling"); return;
  }
  const grants = await ctx.db.query("masterGrants").withIndex("by_run", q => q.eq("runId", runId)).order("desc").take(6);
  const grant = grants.find(g => !g.revokedAt && g.expiresAt > Date.now());
  if (!grant || !masterAutopayEnabled()) { await setState("awaiting_spending_authorization"); return; }
  try { await boundMissions(ctx, run); }
  catch { await setState("failed", "MASTER_PLAN_BINDING_CHANGED"); return; }
  // Serialize through the existing sender lock. Bounded delayed rechecks do not
  // sign, resend or rearm an uncertain/previously attempted payment.
  if (await ctx.db.query("signerLocks").first()) {
    await setState("settling", "WAITING_FOR_SHARED_OPERATOR");
    if ((run.nextSettlementCheckAt ?? 0) <= Date.now() && (run.settlementChecks ?? 0) < 12) {
      await ctx.db.patch(runId, { nextSettlementCheckAt: Date.now() + 15000, settlementChecks: (run.settlementChecks ?? 0) + 1 });
      await ctx.scheduler.runAfter(15000, internal.masterAgentWorker.step, { runId });
    }
    return;
  }
  const next = obligations.find(o => !o.confirmed);
  if (!next) { await setState("failed", "SETTLEMENT_EVIDENCE_INCOMPLETE"); return; }
  try {
    await ctx.runMutation(internal.masterAgentWorker.authorize, { grantId: grant._id, jobId: next.job._id });
    await setState("settling");
  } catch (e) {
    const code = e instanceof ConvexError && typeof e.data === "string" ? e.data : "MASTER_SETTLEMENT_POLICY_BLOCKED";
    await setState("awaiting_spending_authorization", /^[A-Z_]{3,80}$/.test(code) ? code : "MASTER_SETTLEMENT_POLICY_BLOCKED");
  }
} });

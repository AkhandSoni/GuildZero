import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { allowanceConfiguration, allowanceRequired } from "../lib/settlement/allowance";

// Fail closed rather than ignore history when the bounded demo grows too large.
const LIMIT = 1000;
function amount(value: string) {
  if (!/^(0|[1-9]\d{0,27})$/.test(value)) throw new ConvexError("DEMO_ACCOUNTING_INVALID");
  return BigInt(value);
}
export async function allowanceSnapshot(ctx: QueryCtx | MutationCtx, ownerId: Id<"users">) {
  let config: ReturnType<typeof allowanceConfiguration>;
  try { config = allowanceConfiguration(); }
  catch { throw new ConvexError("DEMO_ALLOWANCE_CONFIGURATION_REQUIRED"); }
  const personalLimit = config.owners.get(ownerId);
  if (personalLimit === undefined) throw new ConvexError("DEMO_OWNER_NOT_ALLOWLISTED");
  const [jobs, contracts, intents] = await Promise.all([
    ctx.db.query("jobs").take(LIMIT + 1),
    ctx.db.query("contracts").take(LIMIT + 1),
    ctx.db.query("paymentIntents").take(LIMIT + 1),
  ]);
  if ([jobs, contracts, intents].some(rows => rows.length > LIMIT))
    throw new ConvexError("DEMO_ACCOUNTING_CAPACITY_REACHED");
  const jobMap = new Map(jobs.map(job => [job._id, job]));
  const groups = new Map<Id<"jobs">, { ownerId: Id<"users">; contract: bigint; uncoveredTransfers: bigint; totalTransfers: bigint }>();
  const group = (jobId: Id<"jobs">) => {
    const job = jobMap.get(jobId);
    if (!job) throw new ConvexError("DEMO_ACCOUNTING_INVALID");
    const root = job.parentId ? jobMap.get(job.parentId) : job;
    if (!root || root.parentId || root.ownerId !== job.ownerId) throw new ConvexError("DEMO_ACCOUNTING_INVALID");
    let entry = groups.get(root._id);
    if (!entry) {
      entry = { ownerId: root.ownerId, contract: 0n, uncoveredTransfers: 0n, totalTransfers: 0n };
      groups.set(root._id, entry);
    }
    return { entry, job, root };
  };
  // Root amount includes the entire one-level child allocation, including a
  // child not yet awarded. Child amounts are added only if the root failed.
  const rootContracts = new Map(contracts.map(c => [c.jobId, c]));
  for (const contract of contracts) {
    const { entry, job, root } = group(contract.jobId);
    if (root.unfundedPreviewAcknowledged || contract.state === "failed") continue;
    if (!job.parentId) entry.contract += amount(contract.amountYocto);
    else if (!rootContracts.has(root._id) || rootContracts.get(root._id)?.state === "failed")
      entry.contract += amount(contract.amountYocto);
  }
  // Cover each transfer only by its own allocation. A failed parent cannot
  // absorb an uncertain transfer into its child's still-unpaid obligation.
  const coveredByJob = new Map<Id<"jobs">, bigint>();
  for (const contract of contracts) {
    const { job, root } = group(contract.jobId);
    const rootActive = rootContracts.get(root._id)?.state !== "failed" && rootContracts.has(root._id);
    coveredByJob.set(job._id, root.unfundedPreviewAcknowledged ? 0n : rootActive
      ? amount(job.parentId ? contract.amountYocto : contract.holdbackYocto)
      : contract.state !== "failed" ? amount(contract.amountYocto) : 0n);
  }
  const paidByJob = new Map<Id<"jobs">, bigint>();
  for (const intent of intents) {
    const { job } = group(intent.jobId);
    if (job.ownerId !== intent.ownerId) throw new ConvexError("DEMO_ACCOUNTING_INVALID");
    // READY is covered by its contract. FAILED never frees a completed unpaid
    // contract; final nonexecution can release only a failed work obligation.
    if (["SUBMITTING", "CONFIRMING", "UNKNOWN_RECONCILE", "CONFIRMED"].includes(intent.status) ||
        (intent.status === "READY" && intent.authorizedAt !== undefined))
      paidByJob.set(job._id, (paidByJob.get(job._id) ?? 0n) + amount(intent.amountYocto));
  }
  for (const [jobId, paid] of paidByJob) {
    const { entry } = group(jobId);
    entry.totalTransfers += paid;
    const covered = coveredByJob.get(jobId) ?? 0n;
    if (paid > covered) entry.uncoveredTransfers += paid - covered;
  }
  let ownerUsed = 0n, globalUsed = 0n;
  for (const entry of groups.values()) {
    // Historical split fields may be inconsistent: known transfers are an
    // independent lower bound, never reduced by overlapping allocations.
    const obligated = entry.contract + entry.uncoveredTransfers;
    const used = obligated > entry.totalTransfers ? obligated : entry.totalTransfers;
    globalUsed += used;
    if (entry.ownerId === ownerId) ownerUsed += used;
  }
  return { ownerUsed, globalUsed, personalLimit, globalLimit: config.global };
}
export async function enforceAllowance(ctx: MutationCtx, ownerId: Id<"users">, extra = 0n) {
  if (!allowanceRequired()) return;
  const snapshot = await allowanceSnapshot(ctx, ownerId);
  if (snapshot.ownerUsed + extra > snapshot.personalLimit) throw new ConvexError("DEMO_OWNER_ALLOWANCE_EXCEEDED");
  if (snapshot.globalUsed + extra > snapshot.globalLimit) throw new ConvexError("DEMO_OPERATOR_ALLOWANCE_EXCEEDED");
}

/** A preview has no reserved allowance; admit its exact new transfer atomically. */
export async function authorizeAllowance(ctx: MutationCtx, intent: import("./_generated/dataModel").Doc<"paymentIntents">) {
  if (!allowanceRequired()) return;
  const job = await ctx.db.get(intent.jobId);
  const root = job?.parentId ? await ctx.db.get(job.parentId) : job;
  await enforceAllowance(ctx, intent.ownerId, root?.unfundedPreviewAcknowledged ? amount(intent.amountYocto) : 0n);
}
export { allowanceDenials } from "../lib/allowance-reasons";

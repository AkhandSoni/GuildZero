import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { PAYMENT_POLICY_VERSION } from "./paymentHelpers";
import { testnetAccount, PAYMENT_CAP } from "../lib/settlement/policy";
import { event } from "./workflowHelpers";
import { parseBoundedCsv } from "../lib/economy/csv-input";
import { readSummary } from "../lib/dataset-preview";

const validHash = (value: string | undefined) => !!value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const positive = (value: string) => /^[1-9]\d{0,27}$/.test(value);
async function obligation(ctx: QueryCtx, job: Doc<"jobs">) {
  const [contract, deliverable, payment, dispute] = await Promise.all([
    ctx.db.query("contracts").withIndex("by_job", q => q.eq("jobId", job._id)).unique(),
    ctx.db.query("deliverables").withIndex("by_job", q => q.eq("jobId", job._id)).order("desc").first(),
    ctx.db.query("paymentIntents").withIndex("by_job", q => q.eq("jobId", job._id)).unique(),
    ctx.db.query("disputes").withIndex("by_job", q => q.eq("jobId", job._id)).unique(),
  ]);
  const verification = deliverable ? await ctx.db.query("verifications").withIndex("by_deliverable", q => q.eq("deliverableId", deliverable._id)).unique() : null;
  const approval = verification?.verdict === "pass" || (dispute?.decision === "approve" && dispute.decidedBy === job.ownerId && Number.isSafeInteger(dispute.decidedAt));
  const approved = job.state === "approved" && contract?.state === "completed" && deliverable && verification?.jobId === job._id && approval;
  const bound = approved && payment && payment.ownerId === job.ownerId && payment.jobId === job._id &&
    payment.contractId === contract._id && payment.deliverableId === deliverable._id && payment.verificationId === verification._id &&
    payment.disputeId === (verification.verdict === "pass" ? undefined : dispute?._id) && payment.policyVersion === PAYMENT_POLICY_VERSION &&
    payment.amountYocto === contract.holdbackYocto && positive(payment.amountYocto) && positive(contract.amountYocto) && positive(job.reservedYocto) &&
    BigInt(payment.amountYocto) <= PAYMENT_CAP && BigInt(payment.amountYocto) <= BigInt(contract.amountYocto) && BigInt(payment.amountYocto) <= BigInt(job.reservedYocto) &&
    testnetAccount(payment.sender) && testnetAccount(payment.recipient) && payment.sender !== payment.recipient;
  const confirmed = !!(bound && payment.status === "CONFIRMED" && payment.network === "testnet" && payment.lastReason === "FINAL_MATCHING_TRANSFER" &&
    validHash(payment.txHash) && validHash(payment.blockHash) && /^\d{1,30}$/.test(payment.nonce ?? "") &&
    Number.isSafeInteger(payment.authorizedAt) && Number.isSafeInteger(payment.lastCheckAt));
  return { job, contract, deliverable, payment, verification, confirmed };
}
/** Read-only policy over persisted trusted evidence, independent of current key/config rotation. */
export async function deliveryAccess(ctx: QueryCtx, requested: Doc<"jobs">) {
  const root = requested.parentId ? await ctx.db.get(requested.parentId) : requested;
  if (!root || root.parentId || root.depth !== 0 || root.ownerId !== requested.ownerId || root.missionId !== requested.missionId)
    return { released: false, reason: "DELIVERY_STRUCTURE_INVALID", obligations: [] };
  const children = await ctx.db.query("jobs").withIndex("by_parent", q => q.eq("parentId", root._id)).take(2);
  if ((root.cleanBeforeProcessing && !children.length) || children.length > 1 || children.some(child => child.depth !== 1 || child.ownerId !== root.ownerId || child.missionId !== root.missionId) ||
    (requested._id !== root._id && !children.some(child => child._id === requested._id)))
    return { released: false, reason: "DELIVERY_STRUCTURE_INVALID", obligations: [] };
  const obligations = await Promise.all([root, ...children].map(job => obligation(ctx, job)));
  let allocated = false;
  const [parent, child] = obligations;
  if (parent.contract && positive(parent.contract.amountYocto) && positive(parent.contract.holdbackYocto)) {
    allocated = child ? !!(child.contract && positive(child.contract.amountYocto) && child.contract.holdbackYocto === child.contract.amountYocto &&
      BigInt(parent.contract.holdbackYocto) + BigInt(child.contract.amountYocto) === BigInt(parent.contract.amountYocto) &&
      parent.deliverable?.dependencyDeliverableId === child.deliverable?._id) : parent.contract.amountYocto === parent.contract.holdbackYocto;
  }
  const released = allocated && obligations.every(row => row.confirmed);
  return { released, reason: released ? "CONFIRMED_MISSION_SETTLEMENT" : "CONFIRMED_MISSION_SETTLEMENT_REQUIRED", obligations };
}
export function deliverablePreview(deliverable: Doc<"deliverables">) {
  const summary = deliverable.format === "json" ? readSummary(deliverable.content) : null;
  const csv = deliverable.format === "csv" ? parseBoundedCsv(deliverable.content) : null;
  const headers = summary?.columns.map(column => column.name) ?? (csv?.ok ? csv.value.rawHeader : []);
  return {
    rowCount: summary?.rowCount ?? (csv?.ok ? csv.value.rawRows.length : null),
    columnCount: headers.length, columns: headers.slice(0, 5),
    columnsTruncated: headers.length > 5, bytes: new TextEncoder().encode(deliverable.content).length,
  };
}
/** A new group can complete only when its final payment becomes confirmed. */
export async function recordDeliveryRelease(ctx: MutationCtx, job: Doc<"jobs">) {
  const access = await deliveryAccess(ctx, job);
  if (!access.released) return;
  for (const row of access.obligations) await event(ctx, row.job, "DELIVERABLE_RELEASED", `Latest approved deliverable ${row.deliverable!._id} released after all required testnet transfers were confirmed.`);
}

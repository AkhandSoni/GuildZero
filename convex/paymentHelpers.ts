import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { configuration, testnetAccount, yocto } from "../lib/settlement/policy";
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
    (verification.verdict !== "pass" && dispute?.decision !== "approve")
  )
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
    contract,
    recipient,
    sender: config.sender,
    amountYocto: amount.toString(),
  };
}

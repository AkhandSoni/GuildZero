import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownedJob, user } from "./ownership";
import { audit } from "./paymentHelpers";
import {
  candidateReason,
  reputationWriteAllowed,
  subcontractReason,
} from "../lib/settlement/policy";
export const run = mutation({
  args: {
    jobId: v.id("jobs"),
    scenario: v.union(
      v.literal("overspend"),
      v.literal("recipient"),
      v.literal("duplicate"),
      v.literal("reputation"),
      v.literal("subcontract"),
    ),
  },
  handler: async (ctx, { jobId, scenario }) => {
    const job = await ownedJob(ctx, jobId);
    let reason: string | null = null;
    if (scenario === "reputation")
      reason = reputationWriteAllowed("untrusted_agent")
        ? null
        : "REPUTATION_REQUIRES_VERIFIED_WORKFLOW";
    else if (scenario === "subcontract")
      reason = subcontractReason(1, "1", job.budgetYocto);
    else {
      const intent = await ctx.db
        .query("paymentIntents")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .unique();
      if (!intent || (scenario === "duplicate" && intent.status === "READY"))
        return {
          available: false as const,
          code: "PAYMENT_STATE_PREREQUISITE_REQUIRED",
        };
      const candidate = {
        recipient:
          scenario === "recipient"
            ? intent.recipient === "substitution.testnet"
              ? "other.testnet"
              : "substitution.testnet"
            : intent.recipient,
        amountYocto:
          scenario === "overspend"
            ? (BigInt(intent.amountYocto) + 1n).toString()
            : intent.amountYocto,
      };
      reason = candidateReason(intent, candidate);
    }
    if (!reason)
      return {
        available: false as const,
        code: "NO_REJECTION_FOR_CURRENT_STATE",
      };
    await audit(ctx, job, `CONTROLLED_PROBE_${scenario.toUpperCase()}`, reason);
    return {
      available: true as const,
      decision: "reject" as const,
      reason,
      signingAttempted: false as const,
    };
  },
});
export const history = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await user(ctx);
    return ctx.db
      .query("securityEvents")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
  },
});

import { internalMutation } from "./_generated/server";
import { PUBLIC_AGENTS } from "../lib/agent-directory";
import { reviewCapacity } from "./workflowHelpers";
// Operator-only bounded, idempotent compatibility repair for old disputes.
// It never executes work, decides a dispute or modifies monetary amounts.
export const releaseLegacyReviewCapacity = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const agent of PUBLIC_AGENTS) {
      const contracts = await ctx.db.query("contracts").withIndex("by_agent_state", (q) => q.eq("agentId", agent.id).eq("state", "active")).take(50);
      for (const contract of contracts) {
        const job = await ctx.db.get(contract.jobId);
        if (job?.state === "disputed") { await reviewCapacity(ctx, job); updated++; }
      }
    }
    return { updated };
  },
});

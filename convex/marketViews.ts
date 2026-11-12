import { query } from "./_generated/server";
import { v } from "convex/values";
import { user } from "./ownership";
import { PUBLIC_AGENTS } from "../lib/agent-directory";
import { publicBid, publicContract, publicEvent } from "./publicMarket";
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await user(ctx);
    const [rows, eventRows, paymentRows] = await Promise.all([
      ctx.db
        .query("jobs")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(51),
      ctx.db
        .query("economyEvents")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(101),
      ctx.db
        .query("paymentIntents")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(51),
    ]);
    const jobs = await Promise.all(
      rows.slice(0, 50).map(async (j) => {
        const m = await ctx.db.get(j.missionId);
        return {
          _id: j._id,
          missionId: j.missionId,
          parentId: j.parentId ?? null,
          serviceType: j.serviceType,
          state: j.state,
          title: m?.title ?? "Mission",
          budgetYocto: j.budgetYocto,
          reservedYocto: j.reservedYocto,
        };
      }),
    );
    const bids = (
      await Promise.all(
        jobs.map((j) =>
          ctx.db
            .query("bids")
            .withIndex("by_job", (q) => q.eq("jobId", j._id))
            .take(10),
        ),
      )
    ).flat();
    const contracts = (
      await Promise.all(
        jobs.map((j) =>
          ctx.db
            .query("contracts")
            .withIndex("by_job", (q) => q.eq("jobId", j._id))
            .take(1),
        ),
      )
    ).flat();
    return {
      jobs,
      bids: bids.map(publicBid),
      contracts: contracts.map(publicContract),
      events: eventRows.slice(0, 100).map(publicEvent),
      payments: paymentRows.slice(0, 50),
      truncated: {
        jobs: rows.length > 50,
        events: eventRows.length > 100,
        payments: paymentRows.length > 50,
      },
    };
  },
});
export const agent = query({
  args: { agentId: v.string() },
  handler: async (ctx, { agentId }) => {
    const ownerId = await user(ctx);
    const profile = PUBLIC_AGENTS.find((a) => a.id === agentId);
    if (!profile) return null;
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(101);
    const contracts = (
      await Promise.all(
        jobs.slice(0, 100).map((j) =>
          ctx.db
            .query("contracts")
            .withIndex("by_job", (q) => q.eq("jobId", j._id))
            .take(1),
        ),
      )
    )
      .flat()
      .filter((c) => c.agentId === agentId);
    const reputation = (
      await Promise.all(
        jobs.slice(0, 100).map((j) =>
          ctx.db
            .query("reputationEvents")
            .withIndex("by_job", (q) => q.eq("jobId", j._id))
            .take(1),
        ),
      )
    )
      .flat()
      .filter((r) => r.agentId === agentId);
    return {
      profile,
      contracts: contracts.map(publicContract),
      reputation,
      totalDelta: reputation.reduce((sum, r) => sum + r.delta, 0),
      truncated: jobs.length > 100,
    };
  },
});

// Trusted worker boundary. These functions are INTERNAL: a browser/agent cannot
// submit its own scores, verification verdict, payout, or reputation delta.
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { optionsValidator, checkValidator } from "./marketModel";
import {
  amount,
  text,
  jobById,
  event,
  childrenComplete,
  finish,
} from "./workflowHelpers";
import { INITIAL_AGENTS } from "../lib/agents";
import { validateMission } from "../lib/missions";
import { subcontractReason } from "../lib/settlement/policy";
export const executionContext = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !(["working", "revision"] as string[]).includes(job.state))
      throw new ConvexError("JOB_NOT_EXECUTABLE");
    const child = await ctx.db
      .query("jobs")
      .withIndex("by_parent", (q) => q.eq("parentId", jobId))
      .unique();
    if (!child)
      return { job, inputCsv: job.inputCsv, dependencyDeliverableId: null };
    if (child.state !== "approved")
      throw new ConvexError("CHILD_WORK_INCOMPLETE");
    const deliverable = await ctx.db
      .query("deliverables")
      .withIndex("by_job", (q) => q.eq("jobId", child._id))
      .order("desc")
      .first();
    if (!deliverable || deliverable.format !== "csv")
      throw new ConvexError("CHILD_OUTPUT_MISSING");
    return {
      job,
      inputCsv: deliverable.content,
      dependencyDeliverableId: deliverable._id,
    };
  },
});
export const recordBid = internalMutation({
  args: {
    jobId: v.id("jobs"),
    agentId: v.string(),
    priceYocto: v.string(),
    minimumYocto: v.string(),
    etaMs: v.number(),
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await jobById(ctx, args.jobId);
    if (job.state !== "bidding") throw new ConvexError("AUCTION_CLOSED");
    const mission = await ctx.db.get(job.missionId);
    if (!mission || mission.deadlineAt <= Date.now())
      throw new ConvexError("DEADLINE_EXPIRED");
    const agent = INITIAL_AGENTS.find((a) => a.id === args.agentId);
    if (!agent || !agent.capabilities.some((c) => c === job.serviceType))
      throw new ConvexError("CAPABILITY_MISMATCH");
    const price = amount(args.priceYocto),
      minimum = amount(args.minimumYocto);
    if (
      price <= 0n ||
      minimum < BigInt(agent.reservePriceYocto) ||
      price < minimum ||
      price > amount(job.budgetYocto)
    )
      throw new ConvexError("BID_OUT_OF_BOUNDS");
    if (
      !Number.isSafeInteger(args.etaMs) ||
      args.etaMs <= 0 ||
      Date.now() + args.etaMs > mission.deadlineAt
    )
      throw new ConvexError("DEADLINE_INFEASIBLE");
    const old = await ctx.db
      .query("bids")
      .withIndex("by_job_agent", (q) =>
        q.eq("jobId", job._id).eq("agentId", args.agentId),
      )
      .unique();
    if (old) {
      if (
        old.priceYocto !== args.priceYocto ||
        old.minimumYocto !== args.minimumYocto ||
        old.etaMs !== args.etaMs ||
        old.rationale !== args.rationale
      )
        throw new ConvexError("BID_RETRY_CHANGED");
      return old._id;
    }
    if (
      (
        await ctx.db
          .query("bids")
          .withIndex("by_job", (q) => q.eq("jobId", job._id))
          .take(10)
      ).length >= 10
    )
      throw new ConvexError("BID_LIMIT");
    const id = await ctx.db.insert("bids", {
      ...args,
      rationale: text(args.rationale),
      createdAt: Date.now(),
    });
    await event(
      ctx,
      job,
      "BID_SUBMITTED",
      `${agent.name}: ${args.priceYocto} yoctoNEAR. ${args.rationale}`,
    );
    return id;
  },
});
export const negotiate = internalMutation({
  args: {
    bidId: v.id("bids"),
    round: v.number(),
    action: v.union(
      v.literal("counter"),
      v.literal("accept"),
      v.literal("reject"),
    ),
    priceYocto: v.string(),
    explanation: v.string(),
  },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new ConvexError("BID_NOT_FOUND");
    const job = await jobById(ctx, bid.jobId);
    if (job.state !== "bidding") throw new ConvexError("AUCTION_CLOSED");
    const history = await ctx.db
      .query("negotiations")
      .withIndex("by_bid", (q) => q.eq("bidId", bid._id))
      .collect();
    if (args.round !== 2 && args.round !== 3)
      throw new ConvexError("ROUND_LIMIT");
    if (
      history.some((n) => n.action !== "counter") ||
      history.some((n) => n.round === args.round) ||
      args.round !== (history.length === 0 ? 2 : 3)
    )
      throw new ConvexError("NEGOTIATION_CLOSED_OR_OUT_OF_ORDER");
    const price = amount(args.priceYocto);
    if (
      price <= 0n ||
      price > amount(job.budgetYocto) ||
      (args.action !== "reject" && price < amount(bid.minimumYocto))
    )
      throw new ConvexError("OFFER_OUT_OF_BOUNDS");
    await ctx.db.insert("negotiations", {
      ...args,
      jobId: job._id,
      explanation: text(args.explanation),
    });
    await event(
      ctx,
      job,
      "NEGOTIATION",
      `Round ${args.round} ${args.action}: ${args.priceYocto} yoctoNEAR. ${args.explanation}`,
    );
  },
});
export const award = internalMutation({
  args: { bidId: v.id("bids"), selectionReason: v.string() },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new ConvexError("BID_NOT_FOUND");
    const job = await jobById(ctx, bid.jobId);
    if (job.state !== "bidding") throw new ConvexError("AUCTION_CLOSED");
    const mission = await ctx.db.get(job.missionId);
    if (!mission || mission.deadlineAt <= Date.now())
      throw new ConvexError("DEADLINE_EXPIRED");
    const negotiations = await ctx.db
      .query("negotiations")
      .withIndex("by_bid", (q) => q.eq("bidId", bid._id))
      .collect();
    const latest = negotiations.sort((a, b) => b.round - a.round)[0];
    if (latest && latest.action !== "accept")
      throw new ConvexError("OFFER_NOT_ACCEPTED");
    // Initial submitted offer is binding at its quoted price; counteroffers require acceptance.
    const price = latest?.priceYocto ?? bid.priceYocto;
    if (
      amount(price) <= 0n ||
      amount(price) < amount(bid.minimumYocto) ||
      amount(price) > amount(job.budgetYocto)
    )
      throw new ConvexError("AWARD_OUT_OF_BOUNDS");
    const agent = INITIAL_AGENTS.find((a) => a.id === bid.agentId)!;
    const active = await ctx.db
      .query("contracts")
      .withIndex("by_agent_state", (q) =>
        q.eq("agentId", agent.id).eq("state", "active"),
      )
      .take(agent.capacity);
    if (active.length >= agent.capacity) throw new ConvexError("CAPACITY_FULL");
    if (
      await ctx.db
        .query("contracts")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .unique()
    )
      throw new ConvexError("ALREADY_AWARDED");
    const id = await ctx.db.insert("contracts", {
      jobId: job._id,
      agentId: agent.id,
      bidId: bid._id,
      amountYocto: price,
      holdbackYocto: price,
      state: "active",
      selectionReason: text(args.selectionReason),
      createdAt: Date.now(),
    });
    if (job.parentId) {
      const parentContract = await ctx.db
        .query("contracts")
        .withIndex("by_job", (q) => q.eq("jobId", job.parentId!))
        .unique();
      if (!parentContract || parentContract.state !== "active")
        throw new ConvexError("PARENT_CONTRACT_INACTIVE");
      await ctx.db.patch(parentContract._id, {
        holdbackYocto: (
          amount(parentContract.amountYocto) - amount(price)
        ).toString(),
      });
    }
    await ctx.db.patch(job._id, {
      reservedYocto: price,
      state: "working",
      updatedAt: Date.now(),
    });
    await event(
      ctx,
      job,
      "CONTRACT_AWARDED",
      `${agent.name}: ${price} yoctoNEAR. ${args.selectionReason}`,
    );
    return id;
  },
});
export const subcontract = internalMutation({
  args: {
    parentId: v.id("jobs"),
    budgetYocto: v.string(),
    options: optionsValidator,
  },
  handler: async (ctx, args) => {
    const parent = await jobById(ctx, args.parentId);
    if (
      parent.depth !== 0 ||
      parent.state !== "working" ||
      parent.serviceType !== "csv_summary"
    )
      throw new ConvexError("INVALID_SUBCONTRACT_PARENT");
    if (
      await ctx.db
        .query("jobs")
        .withIndex("by_parent", (q) => q.eq("parentId", parent._id))
        .unique()
    )
      throw new ConvexError("CHILD_LIMIT");
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_job", (q) => q.eq("jobId", parent._id))
      .unique();
    if (!contract) throw new ConvexError("NO_CONTRACT");
    const value = amount(args.budgetYocto);
    if (subcontractReason(parent.depth, args.budgetYocto, contract.amountYocto))
      throw new ConvexError("SUBCONTRACT_OVER_BUDGET");
    // Parent holdback plus child allocation equals the existing award. Never add
    // the child allocation a second time to the buyer's total reservation.
    const mission = await ctx.db.get(parent.missionId);
    if (!mission) throw new ConvexError("MISSION_NOT_FOUND");
    try {
      validateMission({
        ...mission,
        serviceType: "csv_normalize",
        inputCsv: parent.inputCsv,
        maxBudgetYocto: args.budgetYocto,
      });
    } catch {
      throw new ConvexError("INVALID_SUBCONTRACT_INPUT");
    }
    // Every child transforms only explicit columns of the real parent dataset.
    const headers = (await import("papaparse")).default.parse<string[]>(
      parent.inputCsv,
      { skipEmptyLines: "greedy" },
    ).data[0];
    if (
      !args.options.columns.length ||
      args.options.columns.length > 32 ||
      new Set(args.options.columns).size !== args.options.columns.length ||
      args.options.columns.some((c) => !headers.includes(c))
    )
      throw new ConvexError("INVALID_COLUMNS");
    const now = Date.now();
    const id = await ctx.db.insert("jobs", {
      ownerId: parent.ownerId,
      missionId: parent.missionId,
      parentId: parent._id,
      depth: 1,
      serviceType: "csv_normalize",
      inputCsv: parent.inputCsv,
      options: {
        ...args.options,
        caseMode: args.options.caseMode ?? "preserve",
      },
      budgetYocto: args.budgetYocto,
      reservedYocto: "0",
      state: "bidding",
      revisionCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(contract._id, {
      holdbackYocto: (amount(contract.amountYocto) - value).toString(),
    });
    await event(
      ctx,
      parent,
      "SUBCONTRACT_OPENED",
      `Normalization child allocated ${value} yoctoNEAR within existing award.`,
    );
    return id;
  },
});
export const submit = internalMutation({
  args: {
    dependencyDeliverableId: v.optional(v.id("deliverables")),
    jobId: v.id("jobs"),
    format: v.union(v.literal("csv"), v.literal("json")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await jobById(ctx, args.jobId);
    if (job.state !== "working" && job.state !== "revision")
      throw new ConvexError("CANNOT_SUBMIT");
    await childrenComplete(ctx, job);
    const child = await ctx.db
      .query("jobs")
      .withIndex("by_parent", (q) => q.eq("parentId", job._id))
      .unique();
    if (child) {
      const dependency = await ctx.db
        .query("deliverables")
        .withIndex("by_job", (q) => q.eq("jobId", child._id))
        .order("desc")
        .first();
      if (!dependency || dependency._id !== args.dependencyDeliverableId)
        throw new ConvexError("DEPENDENCY_OUTPUT_NOT_BOUND");
    } else if (args.dependencyDeliverableId)
      throw new ConvexError("UNEXPECTED_DEPENDENCY");
    if (!args.content || new TextEncoder().encode(args.content).length > 131072)
      throw new ConvexError("OUTPUT_SIZE");
    if ((job.serviceType === "csv_normalize") !== (args.format === "csv"))
      throw new ConvexError("OUTPUT_FORMAT");
    if (args.format === "json")
      try {
        JSON.parse(args.content);
      } catch {
        throw new ConvexError("INVALID_JSON");
      }
    const id = await ctx.db.insert("deliverables", {
      ...args,
      attempt: job.revisionCount,
      createdAt: Date.now(),
    });
    await ctx.db.patch(job._id, { state: "verifying", updatedAt: Date.now() });
    await event(
      ctx,
      job,
      "DELIVERABLE_SUBMITTED",
      `Attempt ${job.revisionCount + 1} submitted for independent verification.`,
    );
    return id;
  },
});
export const recordVerification = internalMutation({
  args: {
    deliverableId: v.id("deliverables"),
    verdict: v.union(
      v.literal("pass"),
      v.literal("fail"),
      v.literal("needs_human"),
    ),
    checks: v.array(checkValidator),
  },
  handler: async (ctx, args) => {
    const deliverable = await ctx.db.get(args.deliverableId);
    if (!deliverable) throw new ConvexError("DELIVERABLE_NOT_FOUND");
    const job = await jobById(ctx, deliverable.jobId);
    if (job.state !== "verifying") throw new ConvexError("NOT_VERIFYING");
    if (
      await ctx.db
        .query("verifications")
        .withIndex("by_deliverable", (q) =>
          q.eq("deliverableId", deliverable._id),
        )
        .unique()
    )
      throw new ConvexError("ALREADY_VERIFIED");
    if (
      !args.checks.length ||
      args.checks.length > 64 ||
      args.checks.some(
        (c) => !c.code || c.code.length > 100 || c.detail.length > 1000,
      ) ||
      (args.verdict === "pass" && args.checks.some((c) => !c.passed)) ||
      (args.verdict === "fail" && args.checks.every((c) => c.passed))
    )
      throw new ConvexError("INVALID_CHECKS");
    await ctx.db.insert("verifications", {
      ...args,
      jobId: job._id,
      createdAt: Date.now(),
    });
    await event(ctx, job, "VERIFICATION_RESULT", args.verdict);
    if (args.verdict === "pass") await finish(ctx, job, true, "verified");
    else if (args.verdict === "fail" && job.revisionCount === 0) {
      await ctx.db.patch(job._id, {
        state: "revision",
        revisionCount: 1,
        updatedAt: Date.now(),
      });
      await event(
        ctx,
        job,
        "REVISION_REQUESTED",
        "One bounded revision is allowed.",
      );
    } else {
      await ctx.db.patch(job._id, { state: "disputed", updatedAt: Date.now() });
      await ctx.db.insert("disputes", {
        jobId: job._id,
        reason:
          args.verdict === "needs_human"
            ? "Human decision required"
            : "Revision failed verification",
      });
    }
  },
});

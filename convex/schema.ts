import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { jobState, optionsValidator, checkValidator } from "./marketModel";
import { paymentState } from "./paymentModel";
export const missionFields = {
  title: v.string(),
  serviceType: v.union(v.literal("csv_normalize"), v.literal("csv_summary")),
  inputCsv: v.string(),
  maxBudgetYocto: v.string(),
  acceptanceCriteria: v.string(),
  deadlineAt: v.number(),
};
export default defineSchema({
  ...authTables,
  paymentIntents: defineTable({
    ownerId: v.id("users"),
    jobId: v.id("jobs"),
    contractId: v.id("contracts"),
    sender: v.string(),
    recipient: v.string(),
    amountYocto: v.string(),
    network: v.literal("testnet"),
    status: paymentState,
    authorizedAt: v.optional(v.number()),
    txHash: v.optional(v.string()),
    nonce: v.optional(v.string()),
    blockHash: v.optional(v.string()),
    lastReason: v.optional(v.string()),
    lastCheckAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_owner", ["ownerId"]),
  signerLocks: defineTable({
    sender: v.string(),
    intentId: v.id("paymentIntents"),
  }).index("by_sender", ["sender"]),
  securityEvents: defineTable({
    ownerId: v.id("users"),
    jobId: v.id("jobs"),
    scenario: v.string(),
    decision: v.union(v.literal("allow"), v.literal("reject")),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_job", ["jobId"]),
  missions: defineTable({
    ...missionFields,
    ownerId: v.id("users"),
    state: v.union(v.literal("draft"), v.literal("active")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_state", ["ownerId", "state"]),
  jobs: defineTable({
    ownerId: v.id("users"),
    missionId: v.id("missions"),
    parentId: v.optional(v.id("jobs")),
    depth: v.union(v.literal(0), v.literal(1)),
    serviceType: missionFields.serviceType,
    inputCsv: v.string(),
    options: optionsValidator,
    budgetYocto: v.string(),
    reservedYocto: v.string(),
    state: jobState,
    revisionCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_mission", ["missionId"])
    .index("by_parent", ["parentId"]),
  bids: defineTable({
    jobId: v.id("jobs"),
    agentId: v.string(),
    priceYocto: v.string(),
    minimumYocto: v.string(),
    etaMs: v.number(),
    rationale: v.string(),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_agent", ["jobId", "agentId"]),
  negotiations: defineTable({
    jobId: v.id("jobs"),
    bidId: v.id("bids"),
    round: v.number(),
    action: v.union(
      v.literal("counter"),
      v.literal("accept"),
      v.literal("reject"),
    ),
    priceYocto: v.string(),
    explanation: v.string(),
  })
    .index("by_job", ["jobId"])
    .index("by_bid", ["bidId"]),
  contracts: defineTable({
    jobId: v.id("jobs"),
    agentId: v.string(),
    bidId: v.id("bids"),
    amountYocto: v.string(),
    holdbackYocto: v.string(),
    state: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    selectionReason: v.string(),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_agent_state", ["agentId", "state"]),
  deliverables: defineTable({
    dependencyDeliverableId: v.optional(v.id("deliverables")),
    jobId: v.id("jobs"),
    attempt: v.number(),
    format: v.union(v.literal("csv"), v.literal("json")),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_job", ["jobId"]),
  verifications: defineTable({
    jobId: v.id("jobs"),
    deliverableId: v.id("deliverables"),
    verdict: v.union(
      v.literal("pass"),
      v.literal("fail"),
      v.literal("needs_human"),
    ),
    checks: v.array(checkValidator),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_deliverable", ["deliverableId"]),
  disputes: defineTable({
    jobId: v.id("jobs"),
    reason: v.string(),
    decision: v.optional(v.union(v.literal("approve"), v.literal("reject"))),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
  }).index("by_job", ["jobId"]),
  reputationEvents: defineTable({
    jobId: v.id("jobs"),
    agentId: v.string(),
    delta: v.number(),
    cause: v.union(
      v.literal("verified"),
      v.literal("buyer_approved"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_agent", ["agentId"]),
  economyEvents: defineTable({
    ownerId: v.id("users"),
    missionId: v.id("missions"),
    jobId: v.id("jobs"),
    type: v.string(),
    detail: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_job", ["jobId"])
    .index("by_mission", ["missionId"]),
});

import { legacyAuthTables } from "./legacyAuthSchema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { jobState, optionsValidator, checkValidator, scoreValidator } from "./marketModel";
import { paymentState, attemptPhase } from "./paymentModel";
import { mcpScope } from "./mcpPolicy";
import { SERVICE_TYPES } from "../lib/services";
export const missionFields = {
  cleanBeforeProcessing: v.optional(v.boolean()),
  requiresHumanReview: v.optional(v.boolean()),
  options: v.optional(optionsValidator),
  title: v.string(),
  serviceType: v.union(...SERVICE_TYPES.map(v.literal)),
  inputCsv: v.string(),
  maxBudgetYocto: v.string(),
  acceptanceCriteria: v.string(),
  deadlineAt: v.number(),
};
export default defineSchema({
  ...legacyAuthTables,
  masterRuns: defineTable({
    ownerId: v.id("users"), requestId: v.string(), requestHash: v.string(),
    prompt: v.string(), datasets: v.array(v.object({ ref: v.string(), name: v.string(), csv: v.string(), digest: v.string() })),
    datasetHash: v.string(), capYocto: v.string(), deadlineAt: v.number(), requiresHumanReview: v.boolean(),
    clarifications: v.array(v.string()), revision: v.number(), planningAttempts: v.number(),
    state: v.string(), planJson: v.optional(v.string()), planHash: v.optional(v.string()),
    planningClaimToken: v.optional(v.string()), planningClaimUntil: v.optional(v.number()),
    acceptedAt: v.optional(v.number()), cancelledAt: v.optional(v.number()),
    startConsent: v.optional(v.object({ version: v.literal("guildzero-start-v1"), mode: v.union(v.literal("automatic"), v.literal("preview")),
      requestHash: v.string(), datasetHash: v.string(), capYocto: v.string(), revision: v.number(), policyHash: v.string(),
      expiresAt: v.number(), createdAt: v.number(), hash: v.string(), revokedAt: v.optional(v.number()), admittedPlanHash: v.optional(v.string()) })),
    contentRemovedAt: v.optional(v.number()),
    settlementChecks: v.optional(v.number()), nextSettlementCheckAt: v.optional(v.number()),
    error: v.optional(v.string()), inference: v.optional(v.object({ provider: v.literal("groq"), model: v.string(), inferenceMs: v.number(), requests: v.number(), inputTokens: v.union(v.number(), v.null()), outputTokens: v.union(v.number(), v.null()), planningMs: v.number() })),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]).index("by_owner_request", ["ownerId", "requestId"]),
  masterSteps: defineTable({ runId: v.id("masterRuns"), ownerId: v.id("users"), stepId: v.string(), missionId: v.id("missions"), jobId: v.optional(v.id("jobs")) })
    .index("by_run", ["runId"]).index("by_mission", ["missionId"]),
  masterGrants: defineTable({ runId: v.id("masterRuns"), ownerId: v.id("users"), planHash: v.string(), datasetHash: v.string(),
    startConsentHash: v.optional(v.string()),
    capYocto: v.string(), policyHash: v.string(), expiresAt: v.number(), revokedAt: v.optional(v.number()), createdAt: v.number(),
  }).index("by_run", ["runId"]),
  masterReservations: defineTable({ grantId: v.id("masterGrants"), intentId: v.id("paymentIntents"), amountYocto: v.string(), createdAt: v.number() })
    .index("by_grant", ["grantId"]).index("by_intent", ["intentId"]),
  masterEvents: defineTable({ runId: v.id("masterRuns"), ownerId: v.id("users"), type: v.string(), detail: v.string(), createdAt: v.number() })
    .index("by_run", ["runId"]),
  mcpIntegrations: defineTable({
    ownerId: v.id("users"), clientId: v.string(), label: v.string(), digest: v.string(),
    scopes: v.array(mcpScope), missionIds: v.optional(v.array(v.id("missions"))),
    createdAt: v.number(), expiresAt: v.number(), active: v.boolean(), revokedAt: v.optional(v.number()),
  }).index("by_digest", ["digest"]).index("by_owner", ["ownerId"]).index("by_owner_active", ["ownerId", "active"]).index("by_owner_client", ["ownerId", "clientId"]),
  mcpRequests: defineTable({
    ownerId: v.id("users"), integrationId: v.id("mcpIntegrations"), requestId: v.string(),
    fingerprint: v.string(), missionId: v.id("missions"), createdAt: v.number(),
  }).index("by_integration_request", ["integrationId", "requestId"]),
  mcpAudit: defineTable({
    ownerId: v.id("users"), integrationId: v.id("mcpIntegrations"), tool: v.string(), resourceId: v.optional(v.string()),
    decision: v.union(v.literal("allow"), v.literal("deny")), reason: v.string(), createdAt: v.number(),
  }).index("by_owner", ["ownerId"]).index("by_integration", ["integrationId"]),
  mcpRateLimits: defineTable({key: v.string(), windowStart: v.number(), count: v.number()}).index("by_key", ["key"]),
  paymentIntents: defineTable({
    masterGrantId: v.optional(v.id("masterGrants")),
    masterSigningAdmittedAt: v.optional(v.number()),
    recoveryVersion: v.optional(v.literal(2)),
    currentAttemptId: v.optional(v.id("paymentAttempts")),
    attemptCount: v.optional(v.number()),
    lastRecoveryAt: v.optional(v.number()),
    // Optional only for historical records. Unbound intents cannot be signed.
    policyVersion: v.optional(v.string()),
    deliverableId: v.optional(v.id("deliverables")),
    verificationId: v.optional(v.id("verifications")),
    disputeId: v.optional(v.id("disputes")),
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
    .index("by_owner", ["ownerId"])
    .index("by_hash", ["txHash"])
    .index("by_sender_nonce", ["sender", "nonce"]),
  signerLocks: defineTable({
    sender: v.string(),
    intentId: v.id("paymentIntents"),
    attemptId: v.optional(v.id("paymentAttempts")),
  }).index("by_sender", ["sender"]),
  paymentAttempts: defineTable({
    intentId: v.id("paymentIntents"), ownerId: v.id("users"),
    jobId: v.id("jobs"), contractId: v.id("contracts"),
    deliverableId: v.id("deliverables"), verificationId: v.id("verifications"),
    disputeId: v.optional(v.id("disputes")), policyVersion: v.string(),
    network: v.literal("testnet"), sender: v.string(), recipient: v.string(),
    amountYocto: v.string(), generation: v.number(), phase: attemptPhase,
    claimToken: v.optional(v.string()), authorizedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()), signingStartedAt: v.optional(v.number()),
    broadcastStartedAt: v.optional(v.number()), txHash: v.optional(v.string()),
    nonce: v.optional(v.string()), blockHash: v.optional(v.string()),
    lastReason: v.optional(v.string()), lastCheckAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_intent", ["intentId"]),
  paymentRecoveryRequests: defineTable({
    ownerId: v.id("users"), requestId: v.string(), fingerprint: v.string(),
    intentId: v.id("paymentIntents"), failedAttemptId: v.id("paymentAttempts"),
    createdAttemptId: v.id("paymentAttempts"), createdAt: v.number(),
  }).index("by_owner_request", ["ownerId", "requestId"]),
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
    contentRemovedAt: v.optional(v.number()),
    demo: v.optional(v.boolean()),
    ...missionFields,
    ownerId: v.id("users"),
    state: v.union(v.literal("draft"), v.literal("active")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_demo", ["ownerId", "demo"])
    .index("by_owner_state", ["ownerId", "state"])
    .index("by_owner_service_state", ["ownerId", "serviceType", "state"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["ownerId", "state", "serviceType"] }),
  jobs: defineTable({
    contentRemovedAt: v.optional(v.number()),
    unfundedPreviewAcknowledged: v.optional(v.boolean()),
    engineManaged: v.optional(v.boolean()),
    workerVersion: v.optional(v.number()),
    workerError: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    cleanBeforeProcessing: v.optional(v.boolean()),
    requiresHumanReview: v.optional(v.boolean()),
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
    estimatedCostYocto: v.optional(v.string()),
    reputationBps: v.optional(v.number()),
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
    // Optional for old rows only. New writes always bind both fields.
    actorRole: v.optional(v.union(v.literal("buyer"), v.literal("seller"))),
    actorId: v.optional(v.string()),
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
    score: v.optional(scoreValidator),
    jobId: v.id("jobs"),
    agentId: v.string(),
    bidId: v.id("bids"),
    amountYocto: v.string(),
    holdbackYocto: v.string(),
    state: v.union(
      v.literal("active"),
      v.literal("awaiting_review"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    selectionReason: v.string(),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_agent_state", ["agentId", "state"]),
  deliverables: defineTable({
    verificationPayload: v.optional(v.string()),
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
  operatorWalletSnapshots: defineTable({
    account: v.string(), requestedAt: v.number(), pending: v.boolean(),
    checkedAt: v.optional(v.number()), error: v.optional(v.string()),
    liquidYocto: v.optional(v.string()), lockedYocto: v.optional(v.string()),
    totalYocto: v.optional(v.string()), storageYocto: v.optional(v.string()), availableYocto: v.optional(v.string()),
    blockHeight: v.optional(v.number()), blockHash: v.optional(v.string()),
  }).index("by_account", ["account"]),
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

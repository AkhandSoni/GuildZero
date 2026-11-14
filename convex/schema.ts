import { legacyAuthTables } from "./legacyAuthSchema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { jobState, optionsValidator, checkValidator, scoreValidator } from "./marketModel";
import { paymentState, attemptPhase } from "./paymentModel";
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
  paymentIntents: defineTable({
    grantId: v.optional(v.id("spendingGrants")),
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
    grantId: v.optional(v.id("spendingGrants")),
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
  masterAgentRuns: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    prompt: v.string(),
    clarificationResponse: v.optional(v.string()),
    maxBudgetYocto: v.string(),
    deadlineAt: v.number(),
    requiresHumanReview: v.boolean(),
    allowUnfundedPreview: v.boolean(),
    state: v.union(
      v.literal("planning"),
      v.literal("needs_clarification"),
      v.literal("ready"),
      v.literal("executing"),
      v.literal("needs_human_review"),
      v.literal("awaiting_spending_authorization"),
      v.literal("settling"),
      v.literal("payment_uncertain"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    datasets: v.array(
      v.object({
        ref: v.string(),
        name: v.string(),
        csv: v.string(),
        sha256: v.string(),
        rowCount: v.number(),
        byteLength: v.number(),
        headers: v.array(v.string()),
      }),
    ),
    latestPlanJson: v.optional(v.string()),
    planHash: v.optional(v.string()),
    planVersion: v.number(),
    validationError: v.optional(
      v.object({
        code: v.string(),
        message: v.string(),
      }),
    ),
    inferenceEnvelope: v.optional(
      v.object({
        provider: v.string(),
        model: v.string(),
        modelDigest: v.optional(v.string()),
        ollamaVersion: v.optional(v.string()),
        schemaSha256: v.string(),
        promptSha256: v.string(),
        durationMs: v.number(),
        totalDurationNs: v.optional(v.number()),
        loadDurationNs: v.optional(v.number()),
        promptEvalCount: v.optional(v.number()),
        promptEvalDurationNs: v.optional(v.number()),
        evalCount: v.optional(v.number()),
        evalDurationNs: v.optional(v.number()),
        numCtx: v.optional(v.number()),
        numPredict: v.optional(v.number()),
        temperature: v.optional(v.number()),
        seed: v.optional(v.number()),
        status: v.string(),
        errorCode: v.optional(v.string()),
        sanitizedError: v.optional(v.string()),
      }),
    ),
    stepRecords: v.array(
      v.object({
        stepId: v.string(),
        title: v.string(),
        serviceType: missionFields.serviceType,
        datasetRef: v.string(),
        comparisonDatasetRef: v.optional(v.string()),
        maxBudgetYocto: v.string(),
        cleanBeforeProcessing: v.boolean(),
        requiresHumanReview: v.boolean(),
        missionId: v.id("missions"),
        jobId: v.optional(v.id("jobs")),
      }),
    ),
    grantId: v.optional(v.id("spendingGrants")),
    activeRequestId: v.optional(v.string()),
    contentRemovedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_state", ["ownerId", "state"]),
  spendingGrants: defineTable({
    ownerId: v.id("users"),
    runId: v.id("masterAgentRuns"),
    planVersion: v.number(),
    planHash: v.string(),
    datasetDigests: v.array(v.string()),
    missionIds: v.array(v.id("missions")),
    allowedScopes: v.array(
      v.object({
        missionId: v.id("missions"),
        serviceType: missionFields.serviceType,
        cleanBeforeProcessing: v.boolean(),
        stepCapYocto: v.string(),
      }),
    ),
    operatorAccount: v.string(),
    recipientsHash: v.string(),
    policyVersion: v.string(),
    maxTransferYocto: v.string(),
    reservedYocto: v.string(),
    gasReserveDisclosureYocto: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_run", ["runId"]),
  grantReservations: defineTable({
    grantId: v.id("spendingGrants"),
    ownerId: v.id("users"),
    runId: v.id("masterAgentRuns"),
    missionId: v.id("missions"),
    rootJobId: v.id("jobs"),
    jobId: v.id("jobs"),
    intentId: v.id("paymentIntents"),
    amountYocto: v.string(),
    createdAt: v.number(),
  })
    .index("by_grant", ["grantId"])
    .index("by_job", ["jobId"])
    .index("by_intent", ["intentId"]),
});

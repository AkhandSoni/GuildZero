// Types and result wrapper for the deterministic economy kernel
// Do not modify existing shared files.

import type { AgentProfile } from "../agents";
import type { ServiceType } from "../missions";

export const REASON_CODES = [
  "INVALID_INPUT",
  "INVALID_OPTIONS",
  "INVALID_COLUMNS",
  "OPTIONS_REQUIRED",
  "INVALID_AMOUNT",
  "INPUT_TOO_LARGE",
  "INVALID_CSV",
  "INVALID_NUMBER",
  "UNSAFE_CSV_CELL",
  "OUTPUT_TOO_LARGE",
  "CAPABILITY_MISMATCH",
  "CAPACITY_FULL",
  "BUDGET_TOO_LOW",
  "DEADLINE_INFEASIBLE",
  "ROUND_LIMIT",
  "BELOW_SELLER_MINIMUM",
  "OFFER_MADE",
  "OFFER_ACCEPTED",
  "COUNTEROFFER_MADE",
  "OFFER_REJECTED",
  "VERIFICATION_PASSED",
  "ROW_COUNT_MISMATCH",
  "CONTENT_MISMATCH",
  "STATISTICS_MISMATCH",
  "UNSUPPORTED_CRITERIA",
  "SERVICE_EXEC_ERROR",
  "INVALID_DELIVERABLE",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** Generic result type */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ReasonCode; readonly message: string };

/** Workload description used by cost and bidding */
export type Workload = {
  readonly serviceType: ServiceType;
  readonly rowCount: number; // 1-500
  readonly columnCount: number; // 1-32
  readonly complexityBps: number; // basis points, 0-10000
  readonly riskBps: number; // basis points, 0-10000
};

export type CostModel = {
  /** Base cost in yoctoNEAR string */
  readonly baseCostYocto: string;
  /** Per-row cost in yoctoNEAR string */
  readonly perRowCostYocto: string;
  /** Per-cell cost in yoctoNEAR string */
  readonly perCellCostYocto: string;
};

/** Input for cost estimation */
export type CostInput = {
  readonly workload: Workload;
  /** Base cost in yoctoNEAR string */
  readonly baseCostYocto: string;
  /** Per-row cost in yoctoNEAR string */
  readonly perRowCostYocto: string;
  /** Per-cell cost in yoctoNEAR string */
  readonly perCellCostYocto: string;
  /** Optional nested costModel shape */
  readonly costModel?: CostModel;
};

export type CostEstimate = {
  readonly baseCostYocto: string;
  readonly variableCostYocto: string;
  readonly estimatedCostYocto: string;
  readonly explanation: string;
};

/** Input for a bid request */
export type BidInput = {
  readonly agent: AgentProfile;
  readonly workload: Workload;
  readonly costModel: CostModel;
  readonly activeAssignments: number;
  readonly budgetYocto: string;
  readonly nowMs: number;
  readonly deadlineAtMs: number;
  readonly estimatedDurationMs: number;
  readonly bidId: string;
};

export type Offer = {
  readonly agentId: string;
  readonly bidId: string;
  readonly priceYocto: string;
  readonly minimumAcceptableYocto: string;
  readonly estimatedCostYocto: string;
  /** Elapsed completion duration in milliseconds */
  readonly etaMs: number;
  /** Alias for elapsed completion duration in milliseconds */
  readonly estimatedDurationMs?: number;
  readonly strategy: NonNullable<AgentProfile["strategy"]>;
  readonly explanation: string;
};

export type BidOffer = Offer;

export type Decline = {
  readonly reason: string;
  readonly code: ReasonCode;
};

export type BidDecision =
  | { readonly decision: "offer"; readonly offer: Offer }
  | { readonly decision: "decline"; readonly decline: Decline };

export type BidSnapshot = {
  readonly offer: Offer;
  readonly reputationBps: number;
  readonly capabilityMatchBps: number;
};

export type ScoreComponents = {
  readonly price: number;
  readonly eta: number;
  readonly reputation: number;
  readonly capability: number;
  readonly time: number;
};

/** Input for ranking */
export type RankingInput = {
  readonly budgetYocto: string;
  readonly availableDurationMs: number;
  /** Snapshots of offers that passed validation */
  readonly offers?: readonly Offer[];
  /** Reputation and capability scores supplied by backend */
  readonly reputationBps?: readonly number[]; // parallel to offers
  readonly capabilityMatchBps?: readonly number[]; // parallel to offers
  /** Alternative combined snapshot array */
  readonly bids?: readonly BidSnapshot[];
};

export type RankedBid = {
  readonly offer: Offer;
  readonly priceScore: number;
  readonly etaScore: number;
  readonly reputationScore: number;
  readonly capabilityScore: number;
  readonly totalScore: number;
  readonly components: ScoreComponents;
  readonly weightsBps: ScoreComponents;
  readonly totalScoreBps: number;
  readonly rank: number;
  readonly tieBreakExplanation: string;
};

export type NegotiationRound = {
  readonly round: 1 | 2 | 3;
  readonly actorRole: "buyer" | "seller";
  readonly action: "offer" | "counter" | "accept" | "reject";
  readonly priceYocto: string;
  readonly createdAtMs: number;
};

/** Counter-offer negotiation */
export type CounterofferInput = {
  readonly currentOffer: Offer;
  readonly round: 2 | 3;
  readonly buyerOfferYocto: string;
  readonly budgetYocto: string;
  readonly sellerMinimumYocto: string;
  readonly previousNegotiations?: readonly NegotiationDecision[];
  readonly previousRounds?: readonly NegotiationRound[];
};

export type NegotiationDecision =
  | {
      readonly decision: "accept";
      readonly action: "accept";
      readonly offer: Offer;
      readonly priceYocto: string;
      readonly agentId: string;
      readonly bidId: string;
      readonly round: number;
      readonly explanation: string;
    }
  | {
      readonly decision: "counter";
      readonly action: "counter";
      readonly counterOffer: Offer;
      readonly offer: Offer;
      readonly priceYocto: string;
      readonly agentId: string;
      readonly bidId: string;
      readonly round: number;
      readonly explanation: string;
    }
  | {
      readonly decision: "reject";
      readonly action: "reject";
      readonly reason: string;
      readonly code: ReasonCode;
      readonly priceYocto: string;
      readonly agentId: string;
      readonly bidId: string;
      readonly round: number;
      readonly explanation: string;
    };

export type NormalizeOptions = {
  readonly columns: string[];
  readonly caseMode: "preserve" | "lowercase";
};

export type SummaryOptions = {
  readonly columns: string[];
};

export type ServiceOptions = NormalizeOptions | SummaryOptions;

/** Service request union */
export type NormalizeRequest = {
  readonly serviceType: "csv_normalize";
  readonly inputCsv: string;
  readonly options: NormalizeOptions;
};

export type SummaryRequest = {
  readonly serviceType: "csv_summary";
  readonly inputCsv: string;
  readonly options: SummaryOptions;
};

export type ServiceRequest = NormalizeRequest | SummaryRequest;

export type ColumnStatistics = {
  readonly name: string;
  readonly count: number;
  readonly missing: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly sum: number;
  readonly mean: number | null;
};

export type ServiceOutput =
  | {
      readonly serviceType: "csv_normalize";
      readonly format: "csv";
      readonly csv: string;
      readonly rowCount: number;
      readonly columns: readonly string[];
    }
  | {
      readonly serviceType: "csv_summary";
      readonly format: "json";
      readonly rowCount: number;
      readonly columns: readonly ColumnStatistics[];
    };

/** Verification */
export type VerificationRequest = {
  readonly request: ServiceRequest;
  readonly deliverable: unknown;
  /** Optional subjective acceptance criteria; if non-empty, triggers needs_human */
  readonly acceptanceCriteria?: string;
  readonly unsupportedCriteria?: string;
};

export type CheckResult = {
  readonly code: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type VerificationCheck = CheckResult;

export type VerificationResult = {
  readonly verdict: "pass" | "fail" | "needs_human";
  readonly reasonCode: ReasonCode;
  readonly checks: readonly CheckResult[];
};

export interface EconomyEngine {
  estimateCost(input: CostInput): Result<CostEstimate>;
  makeBid(input: BidInput): Result<BidDecision>;
  rankBids(input: RankingInput): Result<readonly RankedBid[]>;
  respondToCounteroffer(input: CounterofferInput): Result<NegotiationDecision>;
  runService(input: ServiceRequest): Result<ServiceOutput>;
  verifyDeliverable(input: VerificationRequest): Result<VerificationResult>;
}

export const JOB_STATES = ["bidding", "working", "verifying", "revision", "disputed", "approved", "rejected", "cancelled", "unawarded"] as const;
export type JobState = (typeof JOB_STATES)[number];
export type MissionState = "draft" | "active";
export type ContractState = "active" | "completed" | "failed";

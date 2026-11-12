import type { AgentProfile } from "../agents";
import type { ServiceType } from "../missions";

/** JSON contracts for the pure engine. Types do not implement its algorithms. */
export const REASON_CODES = [
  "INVALID_INPUT", "INVALID_OPTIONS", "INVALID_COLUMNS", "OPTIONS_REQUIRED",
  "INVALID_AMOUNT", "INPUT_TOO_LARGE", "INVALID_CSV", "INVALID_NUMBER",
  "UNSAFE_CSV_CELL", "OUTPUT_TOO_LARGE", "CAPABILITY_MISMATCH", "CAPACITY_FULL",
  "BUDGET_TOO_LOW", "DEADLINE_INFEASIBLE", "ROUND_LIMIT", "BELOW_SELLER_MINIMUM",
  "OFFER_MADE", "OFFER_ACCEPTED", "COUNTEROFFER_MADE", "OFFER_REJECTED",
  "VERIFICATION_PASSED", "ROW_COUNT_MISMATCH", "CONTENT_MISMATCH",
  "STATISTICS_MISMATCH", "UNSUPPORTED_CRITERIA",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ReasonCode; readonly message: string };
export type Explanation = { readonly code: ReasonCode; readonly detail: string };
export type NormalizeOptions = { columns: string[]; caseMode: "preserve" | "lowercase" };
export type SummaryOptions = { columns: string[] };
export type ServiceOptions = NormalizeOptions | SummaryOptions;
export type ServiceRequest =
  | { readonly serviceType: "csv_normalize"; readonly inputCsv: string; readonly options: NormalizeOptions }
  | { readonly serviceType: "csv_summary"; readonly inputCsv: string; readonly options: SummaryOptions };
export type Workload = {
  readonly serviceType: ServiceType;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly complexityBps: number;
  readonly riskBps: number;
};
export type CostModel = {
  readonly baseCostYocto: string;
  readonly perRowCostYocto: string;
  readonly perCellCostYocto: string;
};
export type CostInput = { readonly workload: Workload; readonly costModel: CostModel };
export type CostEstimate = {
  readonly baseCostYocto: string;
  readonly variableCostYocto: string;
  readonly estimatedCostYocto: string;
  readonly explanation: Explanation;
};
export type BidInput = CostInput & {
  readonly agent: AgentProfile;
  readonly activeAssignments: number;
  readonly budgetYocto: string;
  readonly nowMs: number;
  readonly deadlineAtMs: number;
  readonly estimatedDurationMs: number;
  readonly bidId: string;
};
export type BidOffer = {
  readonly kind: "offer";
  readonly agentId: string;
  readonly bidId: string;
  readonly priceYocto: string;
  readonly minimumAcceptableYocto: string;
  readonly estimatedCostYocto: string;
  readonly estimatedDurationMs: number;
  readonly strategy: NonNullable<AgentProfile["strategy"]>;
  readonly explanation: Explanation;
};
export type BidDecision = BidOffer | {
  readonly kind: "decline";
  readonly agentId: string;
  readonly bidId: string;
  readonly explanation: Explanation;
};
export type ScoreComponents = {
  readonly price: number;
  readonly reputation: number;
  readonly capability: number;
  readonly time: number;
};
export type BidSnapshot = {
  readonly offer: BidOffer;
  readonly reputationBps: number;
  readonly capabilityMatchBps: number;
};
export type RankingInput = {
  readonly budgetYocto: string;
  readonly availableDurationMs: number;
  readonly bids: readonly BidSnapshot[];
};
export type RankedBid = {
  readonly offer: BidOffer;
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
export type CounterofferInput = {
  readonly currentOffer: BidOffer;
  readonly round: 2 | 3;
  readonly buyerOfferYocto: string;
  readonly budgetYocto: string;
  readonly sellerMinimumYocto: string;
  readonly previousRounds: readonly NegotiationRound[];
};
export type NegotiationDecision = {
  readonly action: "accept" | "counter" | "reject";
  readonly round: 2 | 3;
  readonly agentId: string;
  readonly bidId: string;
  /** Rejections reference the rejected price; they never authorize an award. */
  readonly priceYocto: string;
  readonly explanation: Explanation;
};
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
  | { readonly serviceType: "csv_normalize"; readonly format: "csv"; readonly csv: string; readonly rowCount: number; readonly columns: readonly string[] }
  | { readonly serviceType: "csv_summary"; readonly format: "json"; readonly rowCount: number; readonly columns: readonly ColumnStatistics[] };
export type VerificationCheck = { readonly code: string; readonly passed: boolean; readonly detail: string };
export type VerificationRequest = { readonly request: ServiceRequest; readonly deliverable: unknown };
export type VerificationResult = {
  readonly verdict: "pass" | "fail" | "needs_human";
  readonly reasonCode: ReasonCode;
  readonly checks: readonly VerificationCheck[];
};
/** The teammate supplies these implementations; no placeholder exports exist. */
export interface EconomyEngine {
  estimateCost(input: CostInput): Result<CostEstimate>;
  makeBid(input: BidInput): Result<BidDecision>;
  rankBids(input: RankingInput): Result<readonly RankedBid[]>;
  respondToCounteroffer(input: CounterofferInput): Result<NegotiationDecision>;
  runService(input: ServiceRequest): Result<ServiceOutput>;
  verifyDeliverable(input: VerificationRequest): Result<VerificationResult>;
}
export const JOB_STATES = ["bidding", "working", "verifying", "revision", "disputed", "approved", "rejected", "cancelled"] as const;
export type JobState = (typeof JOB_STATES)[number];
export type MissionState = "draft" | "active";
export type ContractState = "active" | "completed" | "failed";

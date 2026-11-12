// Types and result wrapper for the deterministic economy kernel
// Do not modify existing shared files.

import type { AgentProfile } from "../agents";
import type { ServiceType } from "../missions";

/** Generic result type */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

/** Workload description used by cost and bidding */
export type Workload = {
  serviceType: ServiceType;
  rowCount: number; // 1‑500
  columnCount: number; // 1‑32
  complexityBps: number; // basis points, 0‑10000
  riskBps: number; // basis points, 0‑10000
};

/** Input for cost estimation */
export type CostInput = {
  workload: Workload;
  /** Base cost in yoctoNEAR string */
  baseCostYocto: string;
  /** Per‑row cost in yoctoNEAR string */
  perRowCostYocto: string;
  /** Per‑cell cost in yoctoNEAR string */
  perCellCostYocto: string;
};

export type CostEstimate = {
  baseCostYocto: string;
  variableCostYocto: string;
  estimatedCostYocto: string;
  explanation: string;
};

/** Input for a bid request */
export type BidInput = {
  agent: AgentProfile;
  workload: Workload;
  costModel: CostInput; // identical shape, reused for clarity
  activeAssignments: number;
  budgetYocto: string;
  nowMs: number;
  deadlineAtMs: number;
  estimatedDurationMs: number;
  bidId: string;
};

export type Offer = {
  agentId: string;
  bidId: string;
  priceYocto: string;
  minimumAcceptableYocto: string;
  estimatedCostYocto: string;
  etaMs: number;
  strategy: AgentProfile["strategy"];
  explanation: string;
};

export type Decline = {
  reason: string;
  code: string;
};

export type BidDecision =
  | { decision: "offer"; offer: Offer }
  | { decision: "decline"; decline: Decline };

/** Input for ranking */
export type RankingInput = {
  budgetYocto: string;
  availableDurationMs: number;
  /** Snapshots of offers that passed validation */
  offers: readonly Offer[];
  /** Reputation and capability scores supplied by backend */
  reputationBps: readonly number[]; // parallel to offers
  capabilityMatchBps: readonly number[]; // parallel to offers
};

export type RankedBid = {
  offer: Offer;
  priceScore: number;
  etaScore: number;
  reputationScore: number;
  capabilityScore: number;
  totalScore: number;
  rank: number;
  tieBreakExplanation: string;
};

/** Counter‑offer negotiation */
export type CounterofferInput = {
  currentOffer: Offer;
  round: 2 | 3;
  buyerOfferYocto: string;
  budgetYocto: string;
  sellerMinimumYocto: string;
  previousNegotiations?: readonly NegotiationDecision[];
};

export type NegotiationDecision =
  | { decision: "accept"; offer: Offer; round: number }
  | { decision: "counter"; counterOffer: Offer; round: number }
  | { decision: "reject"; reason: string; code: string; round: number };

/** Service request union */
export type NormalizeRequest = {
  serviceType: "csv_normalize";
  inputCsv: string;
  options: {
    columns: readonly string[];
    caseMode: "preserve" | "lowercase";
  };
};

export type SummaryRequest = {
  serviceType: "csv_summary";
  inputCsv: string;
  options: { columns: readonly string[] };
};

export type ServiceRequest = NormalizeRequest | SummaryRequest;

export type ServiceOutput =
  | {
      serviceType: "csv_normalize";
      format: "csv";
      csv: string;
      rowCount: number;
      columns: readonly string[];
    }
  | {
      serviceType: "csv_summary";
      format: "json";
      rowCount: number;
      columns: readonly ColumnStatistics[];
    };

export type ColumnStatistics = {
  name: string;
  count: number;
  missing: number;
  min: number | null;
  max: number | null;
  sum: number;
  mean: number | null;
};

/** Verification */
export type VerificationRequest = {
  request: ServiceRequest;
  deliverable: unknown;
};

export type CheckResult = {
  code: string;
  passed: boolean;
  detail: string;
};

export type VerificationResult = {
  verdict: "pass" | "fail" | "needs_human";
  reasonCode: string;
  checks: readonly CheckResult[];
};

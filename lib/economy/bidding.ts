// Bidding implementation for deterministic economy kernel

import type { BidInput, BidDecision, Offer, Result } from "./types";
import { SERVICE_TYPES } from "../services";
import {
  ceilDiv,
  estimateCost,
  MAX_YOCTO_AMOUNT,
  parseNonNegativeYocto,
  parsePositiveYocto,
  validateWorkload,
} from "./costs";

/** Target strategy margin in basis points */
export const STRATEGY_MARGIN_BPS = {
  aggressive: 500, // 5%
  balanced: 1000, // 10%
  conservative: 2000, // 20%
} as const;

/** Minimum acceptable profit margin in basis points above estimated cost */
export const STRATEGY_MIN_MARGIN_BPS = {
  aggressive: 200, // 2%
  balanced: 500, // 5%
  conservative: 1000, // 10%
} as const;

type SellerStrategy = keyof typeof STRATEGY_MARGIN_BPS;

function isSellerStrategy(value: unknown): value is SellerStrategy {
  return value === "aggressive" || value === "balanced" || value === "conservative";
}

export function makeBid(input: BidInput): Result<BidDecision> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "BidInput must be an object." };
  }

  const {
    agent,
    workload,
    costModel,
    activeAssignments,
    budgetYocto,
    nowMs,
    deadlineAtMs,
    estimatedDurationMs,
    bidId,
  } = input;

  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return { ok: false, code: "INVALID_INPUT", message: "Agent profile must be an object." };
  }
  if (typeof agent.id !== "string" || !agent.id.trim() || typeof agent.name !== "string" || !agent.name.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "Agent must have a valid id and name." };
  }
  if (!Array.isArray(agent.capabilities) || agent.capabilities.some((c) => !SERVICE_TYPES.includes(c))) {
    return { ok: false, code: "INVALID_INPUT", message: "Agent capabilities must be valid service types." };
  }
  if (agent.strategy !== null && !isSellerStrategy(agent.strategy)) {
    return { ok: false, code: "INVALID_INPUT", message: "Unknown seller strategy." };
  }
  const reserve = parseNonNegativeYocto(agent.reservePriceYocto);
  if (reserve === null) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Agent reservePriceYocto must be a valid yoctoNEAR string." };
  }
  if (!Number.isSafeInteger(agent.capacity) || agent.capacity < 1) {
    return { ok: false, code: "INVALID_INPUT", message: "Agent capacity must be a positive integer." };
  }
  if (typeof bidId !== "string" || !bidId.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "bidId must be a nonempty string." };
  }
  if (!Number.isSafeInteger(activeAssignments) || activeAssignments < 0) {
    return { ok: false, code: "INVALID_INPUT", message: "activeAssignments must be a nonnegative integer." };
  }
  const budget = parsePositiveYocto(budgetYocto);
  if (budget === null) {
    return { ok: false, code: "INVALID_AMOUNT", message: "budgetYocto must be a positive integer yoctoNEAR string." };
  }
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(deadlineAtMs) ||
    deadlineAtMs < 0 ||
    !Number.isSafeInteger(estimatedDurationMs) ||
    estimatedDurationMs <= 0
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "nowMs, deadlineAtMs, and positive estimatedDurationMs must be safe integers.",
    };
  }

  const workloadRes = validateWorkload(workload);
  if (!workloadRes.ok) {
    return workloadRes;
  }
  if (!costModel || typeof costModel !== "object" || Array.isArray(costModel)) {
    return { ok: false, code: "INVALID_INPUT", message: "costModel must be an object." };
  }
  const costEstRes = estimateCost({
    workload: workloadRes.value,
    baseCostYocto: costModel.baseCostYocto,
    perRowCostYocto: costModel.perRowCostYocto,
    perCellCostYocto: costModel.perCellCostYocto,
  });
  if (!costEstRes.ok) {
    return costEstRes;
  }

  // 1. Capability check before making a bid
  if (!agent.capabilities.includes(workloadRes.value.serviceType)) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: {
          reason: `Agent ${agent.id} does not support ${workloadRes.value.serviceType}.`,
          code: "CAPABILITY_MISMATCH",
        },
      },
    };
  }

  // Seller strategy must be a valid non-null strategy
  if (!isSellerStrategy(agent.strategy)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Eligible seller must have aggressive, balanced, or conservative strategy.",
    };
  }

  // 2. Capacity check
  if (activeAssignments >= agent.capacity) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: { reason: "capacity full", code: "CAPACITY_FULL" },
      },
    };
  }

  // 3. Deadline feasibility
  if (nowMs >= deadlineAtMs || estimatedDurationMs > deadlineAtMs - nowMs) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: { reason: "deadline infeasible", code: "DEADLINE_INFEASIBLE" },
      },
    };
  }

  // 4. Cost, minimum floor, and strategy pricing
  const cost = BigInt(costEstRes.value.estimatedCostYocto);
  const utilizationBps = Math.floor((activeAssignments * 500) / agent.capacity);
  const targetMarginBps = STRATEGY_MARGIN_BPS[agent.strategy] + utilizationBps;
  const minMarginBps = STRATEGY_MIN_MARGIN_BPS[agent.strategy];

  const minProfitablePrice = ceilDiv(cost * (10000n + BigInt(minMarginBps)), 10000n);
  let minimumAcceptable = reserve > minProfitablePrice ? reserve : minProfitablePrice;
  if (cost > minimumAcceptable) {
    minimumAcceptable = cost;
  }
  if (minimumAcceptable < 1n) {
    minimumAcceptable = 1n;
  }

  const targetPrice = ceilDiv(cost * (10000n + BigInt(targetMarginBps)), 10000n);
  const priceFinal = targetPrice > minimumAcceptable ? targetPrice : minimumAcceptable;

  if (priceFinal > MAX_YOCTO_AMOUNT || minimumAcceptable > MAX_YOCTO_AMOUNT) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Computed bid price exceeds maximum supported yoctoNEAR bound.",
    };
  }

  // 5. Budget check
  if (priceFinal > budget) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: { reason: "budget too low", code: "BUDGET_TOO_LOW" },
      },
    };
  }

  const offer: Offer = {
    agentId: agent.id,
    bidId,
    priceYocto: priceFinal.toString(),
    minimumAcceptableYocto: minimumAcceptable.toString(),
    estimatedCostYocto: cost.toString(),
    etaMs: estimatedDurationMs,
    estimatedDurationMs,
    strategy: agent.strategy,
    explanation: `price ${priceFinal} (cost ${cost}, floor ${minimumAcceptable}, margin ${targetMarginBps}bps)`,
  };

  return { ok: true, value: { decision: "offer", offer } };
}

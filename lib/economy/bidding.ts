// Bidding implementation for deterministic economy kernel

import type {
  BidInput,
  BidDecision,
  Offer,
  Result,
} from "./types";
import { estimateCost } from "./costs";

/** Simple yocto parser used across the package */
function toBigInt(s: string): bigint {
  if (!/^[1-9]\d{0,27}$/.test(s)) throw new Error("Invalid yocto amount");
  return BigInt(s);
}

/** Margin basis points per strategy */
const MARGIN_BPS: Record<string, number> = {
  aggressive: 500, // 5%
  balanced: 1000, //10%
  conservative: 2000, //20%
  null: 1000,
};

export function makeBid(input: BidInput): Result<BidDecision> {
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

  // Capacity check
  if (activeAssignments >= agent.capacity) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: { reason: "capacity full", code: "CAPACITY_FULL" },
      },
    };
  }

  // Deadline feasibility
  if (estimatedDurationMs > deadlineAtMs - nowMs) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: { reason: "deadline infeasible", code: "DEADLINE_INFEASIBLE" },
      },
    };
  }

  // Cost estimation
  const costEst = estimateCost({ ...costModel, workload });
  const cost = toBigInt(costEst.estimatedCostYocto);

  // Determine margin
  const marginBps = MARGIN_BPS[agent.strategy ?? "null"] ?? 1000;
  // price = ceil(cost * (1 + margin/10000))
  const price = (cost * (10000n + BigInt(marginBps)) + 9999n) / 10000n;

  const reserve = toBigInt(agent.reservePriceYocto);
  const priceFinal = price > reserve ? price : reserve; // enforce floor

  const budget = toBigInt(budgetYocto);
  if (priceFinal > budget) {
    return {
      ok: true,
      value: {
        decision: "decline",
        decline: { reason: "budget too low", code: "BUDGET_TOO_LOW" },
      },
    };
  }

  const etaMs = nowMs + estimatedDurationMs;

  const offer: Offer = {
    agentId: agent.id,
    bidId,
    priceYocto: priceFinal.toString(),
    minimumAcceptableYocto: reserve.toString(),
    estimatedCostYocto: cost.toString(),
    etaMs,
    strategy: agent.strategy,
    explanation: `price ${priceFinal} (cost ${cost} + margin ${marginBps}bps)`,
  };

  return { ok: true, value: { decision: "offer", offer } };
}

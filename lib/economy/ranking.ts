// Ranking implementation for deterministic economy kernel
import type { RankingInput, RankedBid, Result } from "./types";

/** Score weight basis points */
const WEIGHTS = {
  price: 6000,
  eta: 2000,
  reputation: 1000,
  capability: 1000,
} as const;

/** Compute price score: floor(10000 * (budget - price) / budget) */
function priceScore(budget: bigint, price: bigint): number {
  if (budget === 0n) return 0;
  const diff = budget - price;
  const ratio = (diff * 10000n) / budget; // floor
  return Number(ratio);
}

/** Compute ETA score: floor(10000 * (availableDuration - eta) / availableDuration) */
function etaScore(available: number, eta: number): number {
  if (available <= 0) return 0;
  const diff = available - eta;
  const ratio = Math.floor((diff * 10000) / available);
  return ratio;
}

export function rankBids(input: RankingInput): Result<readonly RankedBid[]> {
  const { budgetYocto, availableDurationMs, offers, reputationBps, capabilityMatchBps } = input;

  const budget = BigInt(budgetYocto);
  if (budget <= 0n) {
    return { ok: false, code: "INVALID_INPUT", message: "Budget must be positive" };
  }
  if (offers.length === 0) {
    return { ok: true, value: [] };
  }

  // Compute component scores per offer
  const scored: (RankedBid & { totalScore: number })[] = offers.map((offer, idx) => {
    const priceSc = priceScore(budget, BigInt(offer.priceYocto));
    const etaScoreVal = etaScore(availableDurationMs, offer.etaMs);
    const repScore = Math.min(Math.max(reputationBps[idx] ?? 0, 0), 10000);
    const capScore = Math.min(Math.max(capabilityMatchBps[idx] ?? 0, 0), 10000);
    const totalScore = Math.floor(
      (priceSc * WEIGHTS.price +
        etaScoreVal * WEIGHTS.eta +
        repScore * WEIGHTS.reputation +
        capScore * WEIGHTS.capability) /
        10000,
    );
    return {
      offer,
      priceScore: priceSc,
      etaScore: etaScoreVal,
      reputationScore: repScore,
      capabilityScore: capScore,
      totalScore,
      rank: 0,
      tieBreakExplanation: "",
    };
  });

  // Sort by totalScore descending, then deterministic tie‑breakers
  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // lower price wins
    const priceDiff = BigInt(a.offer.priceYocto) - BigInt(b.offer.priceYocto);
    if (priceDiff !== 0n) return priceDiff < 0n ? -1 : 1;
    // lower ETA wins
    const etaDiff = a.offer.etaMs - b.offer.etaMs;
    if (etaDiff !== 0) return etaDiff < 0 ? -1 : 1;
    // lexical order of agentId then bidId
    if (a.offer.agentId !== b.offer.agentId)
      return a.offer.agentId < b.offer.agentId ? -1 : 1;
    return a.offer.bidId < b.offer.bidId ? -1 : 1;
  });

  // Assign ranks and tie‑break explanations
  let currentRank = 1;
  for (let i = 0; i < scored.length; i++) {
    if (i > 0 && scored[i].totalScore === scored[i - 1].totalScore) {
      // tie – keep same rank
    } else {
      currentRank = i + 1;
    }
    scored[i].rank = currentRank;
    const ties = [];
    if (i > 0 && scored[i].totalScore === scored[i - 1].totalScore) {
      // determine which tie‑breaker applied
      if (BigInt(scored[i].offer.priceYocto) !== BigInt(scored[i - 1].offer.priceYocto)) {
        ties.push("price");
      } else if (scored[i].offer.etaMs !== scored[i - 1].offer.etaMs) {
        ties.push("eta");
      } else if (scored[i].offer.agentId !== scored[i - 1].offer.agentId) {
        ties.push("agentId");
      } else {
        ties.push("bidId");
      }
    }
    scored[i].tieBreakExplanation = ties.join(", ") || "none";
  }

  // Strip helper fields
  const result: RankedBid[] = scored.map(({ offer, priceScore, etaScore, reputationScore, capabilityScore, totalScore, rank, tieBreakExplanation }) => ({
    offer,
    priceScore,
    etaScore,
    reputationScore,
    capabilityScore,
    totalScore,
    rank,
    tieBreakExplanation,
  }));

  return { ok: true, value: result };
}

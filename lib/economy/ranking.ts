// Ranking implementation for deterministic economy kernel
import type { RankingInput, RankedBid, Offer, Result, ScoreComponents } from "./types";
import { parseNonNegativeYocto, parsePositiveYocto } from "./costs";

/** Score weight basis points */
export const RANKING_WEIGHTS_BPS: ScoreComponents = {
  price: 6000,
  eta: 2000,
  reputation: 1000,
  capability: 1000,
  time: 2000,
} as const;

function isValidStrategy(s: unknown): s is Offer["strategy"] {
  return s === "aggressive" || s === "balanced" || s === "conservative";
}

function validateOfferSnapshot(offer: unknown): Result<{
  offer: Offer;
  price: bigint;
  minimumAcceptable: bigint;
  estimatedCost: bigint;
  durationMs: number;
}> {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) {
    return { ok: false, code: "INVALID_INPUT", message: "Offer snapshot must be an object." };
  }
  const rec = offer as Record<string, unknown>;
  if (rec.decision === "decline" || rec.kind === "decline") {
    return { ok: false, code: "INVALID_INPUT", message: "Declined bids cannot be ranked." };
  }
  if (typeof rec.agentId !== "string" || !rec.agentId.trim() || typeof rec.bidId !== "string" || !rec.bidId.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "Offer must include nonempty agentId and bidId." };
  }
  if (!isValidStrategy(rec.strategy)) {
    return { ok: false, code: "INVALID_INPUT", message: "Offer has an invalid seller strategy." };
  }
  const price = parsePositiveYocto(rec.priceYocto);
  const minimumAcceptable = parsePositiveYocto(rec.minimumAcceptableYocto);
  const estimatedCost = parseNonNegativeYocto(rec.estimatedCostYocto);
  if (price === null || minimumAcceptable === null || estimatedCost === null) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Offer monetary fields must be canonical yoctoNEAR strings." };
  }

  const rawDuration = rec.estimatedDurationMs ?? rec.etaMs;
  if (!Number.isSafeInteger(rawDuration) || (rawDuration as number) <= 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Offer etaMs/estimatedDurationMs must be a positive integer." };
  }

  const durationMs = rawDuration as number;
  const normalizedOffer: Offer = {
    agentId: rec.agentId,
    bidId: rec.bidId,
    priceYocto: price.toString(),
    minimumAcceptableYocto: minimumAcceptable.toString(),
    estimatedCostYocto: estimatedCost.toString(),
    etaMs: Number.isSafeInteger(rec.etaMs) ? (rec.etaMs as number) : durationMs,
    estimatedDurationMs: durationMs,
    strategy: rec.strategy,
    explanation: typeof rec.explanation === "string" ? rec.explanation : "",
  };

  return {
    ok: true,
    value: {
      offer: normalizedOffer,
      price,
      minimumAcceptable,
      estimatedCost,
      durationMs,
    },
  };
}

/** Compute price score in 0..10000: floor(10000 * (budget - price) / budget) */
function computePriceScore(budget: bigint, price: bigint): number {
  const diff = budget - price;
  const ratio = (diff * 10000n) / budget;
  return Number(ratio);
}

/** Compute ETA score in 0..10000: floor(10000 * (availableDuration - duration) / availableDuration) */
function computeEtaScore(availableDurationMs: number, durationMs: number): number {
  const diff = BigInt(availableDurationMs - durationMs);
  const ratio = (diff * 10000n) / BigInt(availableDurationMs);
  return Number(ratio);
}

/** Code-point lexical comparison (locale-independent) */
function compareCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function rankBids(input: RankingInput): Result<readonly RankedBid[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "RankingInput must be an object." };
  }

  const budget = parsePositiveYocto(input.budgetYocto);
  if (budget === null) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Budget must be a positive canonical yoctoNEAR string." };
  }
  if (!Number.isSafeInteger(input.availableDurationMs) || input.availableDurationMs <= 0) {
    return { ok: false, code: "INVALID_INPUT", message: "availableDurationMs must be a positive safe integer." };
  }

  let offers: readonly Offer[];
  let reputationBps: readonly number[];
  let capabilityMatchBps: readonly number[];

  if (input.bids !== undefined) {
    if (!Array.isArray(input.bids)) {
      return { ok: false, code: "INVALID_INPUT", message: "bids must be an array." };
    }
    const extractedOffers: Offer[] = [];
    const extractedRep: number[] = [];
    const extractedCap: number[] = [];
    for (const snap of input.bids) {
      if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
        return { ok: false, code: "INVALID_INPUT", message: "Each bid snapshot must be an object." };
      }
      extractedOffers.push(snap.offer);
      extractedRep.push(snap.reputationBps);
      extractedCap.push(snap.capabilityMatchBps);
    }
    offers = extractedOffers;
    reputationBps = extractedRep;
    capabilityMatchBps = extractedCap;
  } else {
    if (!Array.isArray(input.offers) || !Array.isArray(input.reputationBps) || !Array.isArray(input.capabilityMatchBps)) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "offers, reputationBps, and capabilityMatchBps must be arrays.",
      };
    }
    if (
      input.reputationBps.length !== input.offers.length ||
      input.capabilityMatchBps.length !== input.offers.length
    ) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "reputationBps and capabilityMatchBps must match offers length.",
      };
    }
    offers = input.offers;
    reputationBps = input.reputationBps;
    capabilityMatchBps = input.capabilityMatchBps;
  }

  if (offers.length === 0) {
    return { ok: true, value: [] };
  }

  const eligibleScored: {
    offer: Offer;
    price: bigint;
    durationMs: number;
    priceScore: number;
    etaScore: number;
    reputationScore: number;
    capabilityScore: number;
    totalScore: number;
  }[] = [];

  for (let i = 0; i < offers.length; i++) {
    const rep = reputationBps[i];
    const cap = capabilityMatchBps[i];
    if (!Number.isSafeInteger(rep) || rep < 0 || rep > 10000) {
      return { ok: false, code: "INVALID_INPUT", message: "reputationBps entries must be integers in 0..10000." };
    }
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > 10000) {
      return { ok: false, code: "INVALID_INPUT", message: "capabilityMatchBps entries must be integers in 0..10000." };
    }

    const validatedRes = validateOfferSnapshot(offers[i]);
    if (!validatedRes.ok) {
      return validatedRes;
    }
    const { offer, price, minimumAcceptable, estimatedCost, durationMs } = validatedRes.value;

    // Filter out ineligible candidates before scoring:
    // 1. Over budget
    // 2. Below seller minimum or minimum below estimated cost
    // 3. Exceeds available duration (expired / infeasible ETA)
    // 4. Zero capability match
    if (
      price > budget ||
      price < minimumAcceptable ||
      minimumAcceptable < estimatedCost ||
      durationMs > input.availableDurationMs ||
      cap <= 0
    ) {
      continue;
    }

    const pScore = computePriceScore(budget, price);
    const eScore = computeEtaScore(input.availableDurationMs, durationMs);

    if (
      !Number.isSafeInteger(pScore) ||
      pScore < 0 ||
      pScore > 10000 ||
      !Number.isSafeInteger(eScore) ||
      eScore < 0 ||
      eScore > 10000
    ) {
      continue;
    }

    const totalScore = Number(
      (BigInt(pScore) * BigInt(RANKING_WEIGHTS_BPS.price) +
        BigInt(eScore) * BigInt(RANKING_WEIGHTS_BPS.eta) +
        BigInt(rep) * BigInt(RANKING_WEIGHTS_BPS.reputation) +
        BigInt(cap) * BigInt(RANKING_WEIGHTS_BPS.capability)) /
        10000n,
    );

    eligibleScored.push({
      offer,
      price,
      durationMs,
      priceScore: pScore,
      etaScore: eScore,
      reputationScore: rep,
      capabilityScore: cap,
      totalScore,
    });
  }

  // Sort by totalScore descending, then deterministic tie-breakers:
  // 1. lower price
  // 2. lower ETA duration
  // 3. agentId code-point order
  // 4. bidId code-point order
  eligibleScored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.price !== b.price) return a.price < b.price ? -1 : 1;
    if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
    const agentCmp = compareCodePoint(a.offer.agentId, b.offer.agentId);
    if (agentCmp !== 0) return agentCmp;
    return compareCodePoint(a.offer.bidId, b.offer.bidId);
  });

  function describeTieBreak(
    curr: (typeof eligibleScored)[number],
    other: (typeof eligibleScored)[number],
  ): string {
    if (curr.price !== other.price) return "price";
    if (curr.durationMs !== other.durationMs) return "eta";
    if (curr.offer.agentId !== other.offer.agentId) return "agentId";
    return "bidId";
  }

  const ranked: RankedBid[] = eligibleScored.map((entry, idx) => {
    const reasons: string[] = [];
    if (idx > 0 && eligibleScored[idx - 1].totalScore === entry.totalScore) {
      reasons.push(describeTieBreak(entry, eligibleScored[idx - 1]));
    } else if (idx + 1 < eligibleScored.length && eligibleScored[idx + 1].totalScore === entry.totalScore) {
      reasons.push(describeTieBreak(entry, eligibleScored[idx + 1]));
    }
    const components: ScoreComponents = {
      price: entry.priceScore,
      eta: entry.etaScore,
      reputation: entry.reputationScore,
      capability: entry.capabilityScore,
      time: entry.etaScore,
    };
    return {
      offer: entry.offer,
      priceScore: entry.priceScore,
      etaScore: entry.etaScore,
      reputationScore: entry.reputationScore,
      capabilityScore: entry.capabilityScore,
      totalScore: entry.totalScore,
      components,
      weightsBps: RANKING_WEIGHTS_BPS,
      totalScoreBps: entry.totalScore,
      rank: idx + 1,
      tieBreakExplanation: reasons.join(", ") || "none",
    };
  });

  return { ok: true, value: ranked };
}

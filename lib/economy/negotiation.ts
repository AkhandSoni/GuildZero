// Negotiation implementation for deterministic economy kernel
import type { CounterofferInput, NegotiationDecision, Offer, Result } from "./types";
import { parseNonNegativeYocto, parsePositiveYocto } from "./costs";

/** Strategy concession rates in basis points of remaining spread above effective floor */
const CONCESSION_BPS = {
  aggressive: 5000, // concedes 50% of spread toward seller floor
  balanced: 3500, // concedes 35% of spread toward seller floor
  conservative: 2000, // concedes 20% of spread toward seller floor
} as const;

function isValidStrategy(s: unknown): s is Offer["strategy"] {
  return s === "aggressive" || s === "balanced" || s === "conservative";
}

/**
 * Respond to a buyer counteroffer in round 2 or 3.
 * Deterministic rules:
 * - Effective seller floor is max(sellerMinimumYocto, currentOffer.minimumAcceptableYocto, currentOffer.estimatedCostYocto).
 * - If buyerOfferYocto >= effectiveFloor and buyerOfferYocto <= budgetYocto, accept at buyerOfferYocto.
 * - Otherwise, if round === 2 and effectiveFloor <= budgetYocto, counter within [effectiveFloor, min(currentOffer.priceYocto, budgetYocto)].
 * - If round === 3 or no valid counter exists within [effectiveFloor, budgetYocto], reject.
 */
export function respondToCounteroffer(input: CounterofferInput): Result<NegotiationDecision> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "CounterofferInput must be an object." };
  }

  const { currentOffer, round, buyerOfferYocto, budgetYocto, sellerMinimumYocto } = input;

  if (!Number.isSafeInteger(round) || (round !== 2 && round !== 3)) {
    return {
      ok: false,
      code: typeof round === "number" && round > 3 ? "ROUND_LIMIT" : "INVALID_INPUT",
      message: "Negotiation round must be 2 or 3.",
    };
  }

  if (!currentOffer || typeof currentOffer !== "object" || Array.isArray(currentOffer)) {
    return { ok: false, code: "INVALID_INPUT", message: "currentOffer must be an object." };
  }
  if (
    typeof currentOffer.agentId !== "string" ||
    !currentOffer.agentId.trim() ||
    typeof currentOffer.bidId !== "string" ||
    !currentOffer.bidId.trim()
  ) {
    return { ok: false, code: "INVALID_INPUT", message: "currentOffer must have nonempty agentId and bidId." };
  }
  if (!isValidStrategy(currentOffer.strategy)) {
    return { ok: false, code: "INVALID_INPUT", message: "currentOffer has an invalid strategy." };
  }
  if (!Number.isSafeInteger(currentOffer.etaMs) || currentOffer.etaMs <= 0) {
    return { ok: false, code: "INVALID_INPUT", message: "currentOffer.etaMs must be a positive integer." };
  }

  const currentPrice = parsePositiveYocto(currentOffer.priceYocto);
  const offerMin = parsePositiveYocto(currentOffer.minimumAcceptableYocto);
  const offerCost = parseNonNegativeYocto(currentOffer.estimatedCostYocto);
  const buyerOffer = parsePositiveYocto(buyerOfferYocto);
  const budget = parsePositiveYocto(budgetYocto);
  const sellerMin = parsePositiveYocto(sellerMinimumYocto);

  if (
    currentPrice === null ||
    offerMin === null ||
    offerCost === null ||
    buyerOffer === null ||
    budget === null ||
    sellerMin === null
  ) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "All monetary negotiation inputs must be canonical integer yoctoNEAR strings.",
    };
  }

  // Effective negotiation floor: at least max(sellerMinimum, offer.minimumAcceptable, offer.estimatedCost, 1)
  let effectiveFloor = sellerMin > offerMin ? sellerMin : offerMin;
  if (offerCost > effectiveFloor) {
    effectiveFloor = offerCost;
  }

  // If buyer offer exceeds buyer's own budget, cannot accept
  if (buyerOffer > budget) {
    const reason = `buyer offer ${buyerOffer} exceeds buyer budget ${budget}`;
    return {
      ok: true,
      value: {
        decision: "reject",
        action: "reject",
        reason,
        code: "BUDGET_TOO_LOW",
        priceYocto: buyerOffer.toString(),
        agentId: currentOffer.agentId,
        bidId: currentOffer.bidId,
        round,
        explanation: reason,
      },
    };
  }

  // If seller's effective floor exceeds the buyer's budget, reject immediately
  if (effectiveFloor > budget) {
    const reason = `seller minimum ${effectiveFloor} exceeds buyer budget ${budget}`;
    return {
      ok: true,
      value: {
        decision: "reject",
        action: "reject",
        reason,
        code: "BELOW_SELLER_MINIMUM",
        priceYocto: buyerOffer.toString(),
        agentId: currentOffer.agentId,
        bidId: currentOffer.bidId,
        round,
        explanation: reason,
      },
    };
  }

  // Accept if buyerOffer satisfies effectiveFloor and budget
  if (buyerOffer >= effectiveFloor && buyerOffer <= budget) {
    const acceptedPriceStr = buyerOffer.toString();
    const explanation = `accepted buyer offer of ${acceptedPriceStr} (floor ${effectiveFloor}, budget ${budget})`;
    const acceptedOffer: Offer = {
      ...currentOffer,
      priceYocto: acceptedPriceStr,
      minimumAcceptableYocto: effectiveFloor.toString(),
      explanation,
    };
    return {
      ok: true,
      value: {
        decision: "accept",
        action: "accept",
        offer: acceptedOffer,
        priceYocto: acceptedPriceStr,
        agentId: currentOffer.agentId,
        bidId: currentOffer.bidId,
        round,
        explanation,
      },
    };
  }

  // Buyer offer is below effectiveFloor.
  // In round 2, propose a counteroffer within [effectiveFloor, min(currentPrice, budget)].
  if (round === 2) {
    const upperBound = currentPrice <= budget ? currentPrice : budget;
    if (upperBound < effectiveFloor) {
      const reason = "current offer ceiling is below effective seller floor";
      return {
        ok: true,
        value: {
          decision: "reject",
          action: "reject",
          reason,
          code: "BELOW_SELLER_MINIMUM",
          priceYocto: buyerOffer.toString(),
          agentId: currentOffer.agentId,
          bidId: currentOffer.bidId,
          round,
          explanation: reason,
        },
      };
    }

    const concessionBps = BigInt(CONCESSION_BPS[currentOffer.strategy]);
    const spread = upperBound - effectiveFloor;
    const concession = (spread * concessionBps) / 10000n;
    let proposed = upperBound - concession;
    if (proposed < effectiveFloor) {
      proposed = effectiveFloor;
    }
    if (proposed > budget) {
      proposed = budget;
    }

    const proposedStr = proposed.toString();
    const explanation = `counter to ${proposedStr} (floor ${effectiveFloor}, budget ${budget})`;
    const counterOffer: Offer = {
      ...currentOffer,
      priceYocto: proposedStr,
      minimumAcceptableYocto: effectiveFloor.toString(),
      explanation,
    };

    return {
      ok: true,
      value: {
        decision: "counter",
        action: "counter",
        counterOffer,
        offer: counterOffer,
        priceYocto: proposedStr,
        agentId: currentOffer.agentId,
        bidId: currentOffer.bidId,
        round,
        explanation,
      },
    };
  }

  // Round 3: final round cannot emit another counteroffer; reject offer below seller minimum
  const reason = `buyer offer ${buyerOffer} is below seller floor ${effectiveFloor} at round 3 limit`;
  return {
    ok: true,
    value: {
      decision: "reject",
      action: "reject",
      reason,
      code: "BELOW_SELLER_MINIMUM",
      priceYocto: buyerOffer.toString(),
      agentId: currentOffer.agentId,
      bidId: currentOffer.bidId,
      round,
      explanation: reason,
    },
  };
}

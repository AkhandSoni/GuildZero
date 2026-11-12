// Negotiation implementation for deterministic economy kernel
import type { CounterofferInput, NegotiationDecision, Result } from "./types";

/** Simple yocto parser */
function toBigInt(s: string): bigint {
  if (!/^[1-9]\d{0,27}$/.test(s)) throw new Error("Invalid yocto amount");
  return BigInt(s);
}

/** Respond to a counteroffer. Deterministic rules:
 * - If buyerOfferYocto >= currentOffer.minimumAcceptableYocto and <= budgetYocto, accept.
 * - Otherwise, if round is 2, propose a counteroffer incremented by 1 yocto (or next integer) not exceeding budget.
 * - If round is 3 or price would exceed budget, reject.
 */
export function respondToCounteroffer(input: CounterofferInput): Result<NegotiationDecision> {
  const { currentOffer, round, buyerOfferYocto, budgetYocto, sellerMinimumYocto } = input;
  const buyerOffer = toBigInt(buyerOfferYocto);
  const budget = toBigInt(budgetYocto);
  const sellerMin = toBigInt(sellerMinimumYocto);

  // Validate round
  if (round !== 2 && round !== 3) {
    return { ok: false, code: "INVALID_INPUT", message: "Round must be 2 or 3" };
  }

  // Accept if within bounds
  if (buyerOffer >= sellerMin && buyerOffer <= budget) {
    const accept: NegotiationDecision = {
      decision: "accept",
      offer: currentOffer,
      round,
    };
    return { ok: true, value: accept };
  }

  // Counter if round 2 and can increase price within budget
  if (round === 2) {
    // propose price = max(buyerOffer, currentOffer.price) + 1 yocto, but not exceed budget
    const base = buyerOffer > toBigInt(currentOffer.priceYocto) ? buyerOffer : toBigInt(currentOffer.priceYocto);
    const proposed = base + 1n;
    if (proposed > budget) {
      const reject: NegotiationDecision = {
        decision: "reject",
        reason: "budget exceeded for counteroffer",
        code: "BUDGET_TOO_LOW",
        round,
      };
      return { ok: true, value: reject };
    }
    const counter: NegotiationDecision = {
      decision: "counter",
      counterOffer: {
        ...currentOffer,
        priceYocto: proposed.toString(),
        explanation: `counter to ${proposed}`,
      },
      round,
    };
    return { ok: true, value: counter };
  }

  // round 3 reject
  const reject: NegotiationDecision = {
    decision: "reject",
    reason: "no further rounds allowed",
    code: "ROUND_LIMIT",
    round,
  };
  return { ok: true, value: reject };
}

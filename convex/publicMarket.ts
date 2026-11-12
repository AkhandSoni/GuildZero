import type { Doc } from "./_generated/dataModel";
// Explicit allowlists prevent new private fields from silently reaching clients.
export function publicBid(b: Doc<"bids">) {
  return {
    _id: b._id,
    jobId: b.jobId,
    agentId: b.agentId,
    priceYocto: b.priceYocto,
    etaMs: b.etaMs,
    createdAt: b.createdAt,
    actorRole: "seller" as const,
    rationale: "Seller offer; capability, deadline and buyer budget checked.",
  };
}
export function publicNegotiation(n: Doc<"negotiations">) {
  const bound = Boolean(n.actorRole && n.actorId);
  return {
    _id: n._id,
    jobId: n.jobId,
    bidId: n.bidId,
    round: n.round,
    action: n.action,
    priceYocto: n.priceYocto,
    actorRole: bound ? n.actorRole! : null,
    actorId: bound ? n.actorId! : null,
    legacy: !bound,
    explanation: bound
      ? `${n.actorRole} ${n.action} in round ${n.round}.`
      : "Legacy record: actor unknown; reassessment required.",
  };
}
export function publicContract(c: Doc<"contracts">) {
  return {
    _id: c._id,
    jobId: c.jobId,
    agentId: c.agentId,
    bidId: c.bidId,
    amountYocto: c.amountYocto,
    holdbackYocto: c.holdbackYocto,
    state: c.state,
    createdAt: c.createdAt,
    selectionReason:
      "Offer selected within the buyer budget; private cost diagnostics are not disclosed.",
  };
}
export function publicEvent(e: Doc<"economyEvents">) {
  const safe: Record<string, string> = {
    BID_SUBMITTED:
      "Seller submitted an eligible offer. See the bid for its public price.",
    NEGOTIATION:
      "A negotiation action was recorded. See the transcript for actor, round and offered price.",
    CONTRACT_AWARDED: "An eligible offer was awarded within the buyer budget.",
  };
  return {
    _id: e._id,
    ownerId: e.ownerId,
    missionId: e.missionId,
    jobId: e.jobId,
    type: e.type,
    createdAt: e.createdAt,
    detail: safe[e.type] ?? e.detail,
  };
}

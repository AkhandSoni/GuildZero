export type WorkJob = { _id: string; missionId: string; parentId?: string | null; state: string; serviceType: string; title?: string; deliveryReleased?: boolean; deliveryConfirmedPayments?: number; deliveryRequiredPayments?: number };
export type WorkEvent = { _id: string; jobId: string; missionId: string; type: string; detail: string; createdAt: number };
export type StepTone = "done" | "current" | "attention" | "stopped" | "pending";
export const statusLabels: Record<string, string> = {
  bidding: "Receiving offers", working: "In progress", revision: "Revising output", verifying: "Checking results",
  approved: "Work accepted", disputed: "Needs your review", rejected: "Work rejected", cancelled: "Cancelled", unawarded: "No eligible offer",
};
export function workLabel(job: Pick<WorkJob, "serviceType" | "parentId">) {
  return job.parentId ? "Cleaning subcontract" : job.serviceType === "csv_summary" ? "Main analysis" : "Data normalization";
}
export function workflowSteps(state: string, eventTypes: readonly string[], paymentStatus = "NONE") {
  const has = (type: string) => eventTypes.includes(type);
  const awarded = has("CONTRACT_AWARDED") || ["working", "revision", "verifying", "approved", "disputed", "rejected"].includes(state);
  const output = has("DELIVERABLE_SUBMITTED") || ["verifying", "approved"].includes(state);
  const failed = has("EXECUTION_REQUIRES_REVIEW") || has("DEPENDENCY_FAILED");
  const steps: { label: string; detail: string; tone: StepTone }[] = [
    { label: "Auction", detail: awarded ? "Agent selected" : state === "bidding" ? "Receiving offers" : "Not awarded", tone: awarded ? "done" : state === "bidding" ? "current" : "stopped" },
    { label: "Processing", detail: output ? "Output submitted" : failed ? "Could not complete" : ["working","revision"].includes(state) ? "Agent at work" : ["rejected","cancelled","unawarded"].includes(state) ? "Stopped" : "Waiting", tone: output ? "done" : failed ? "attention" : ["working","revision"].includes(state) ? "current" : "pending" },
    { label: "Review", detail: state === "approved" ? "Work accepted" : state === "disputed" ? "Your decision needed" : state === "rejected" ? "Work rejected" : state === "verifying" ? "Checking results" : "Not reviewed", tone: state === "approved" ? "done" : state === "disputed" ? "attention" : state === "rejected" ? "stopped" : state === "verifying" ? "current" : "pending" },
    { label: "Payment", detail: "Requires approved work", tone: "pending" },
  ];
  if (paymentStatus === "CONFIRMED") steps[3] = { label: "Payment", detail: "Testnet receipt confirmed", tone: "done" };
  else if (paymentStatus === "UNKNOWN_RECONCILE") steps[3] = { label: "Payment", detail: "Outcome needs checking", tone: "attention" };
  else if (["SUBMITTING","CONFIRMING"].includes(paymentStatus)) steps[3] = { label: "Payment", detail: "Awaiting chain confirmation", tone: "current" };
  else if (paymentStatus === "FAILED") steps[3] = { label: "Payment", detail: "Payment did not complete", tone: "stopped" };
  else if (paymentStatus === "READY") steps[3] = { label: "Payment", detail: "Awaiting authorization", tone: "attention" };
  else if (state === "approved") steps[3].detail = paymentStatus === "LOADING" ? "Checking receipt" : paymentStatus === "UNAVAILABLE" ? "Open receipt for status" : "Not prepared";
  return steps;
}
const eventLabels: Record<string, string> = {
  DELIVERABLE_RELEASED: "Full result unlocked", UNFUNDED_PREVIEW_ACKNOWLEDGED: "Metadata-only run acknowledged",
  AUCTION_OPENED: "Auction opened", BID_SUBMITTED: "Offer received", NEGOTIATION: "Price negotiated", CONTRACT_AWARDED: "Agent selected",
  SUBCONTRACT_OPENED: "Cleaning delegated", DELIVERABLE_SUBMITTED: "Output submitted", VERIFICATION_RESULT: "Output checked",
  WORK_APPROVED: "Work accepted", WORK_REJECTED: "Work rejected", EXECUTION_REQUIRES_REVIEW: "Processing could not finish",
  AWAITING_OWNER_REVIEW: "Ready for your decision", DISPUTE_RESOLVED: "Your decision recorded", REVISION_REQUESTED: "Revision requested",
  DEPENDENCY_FAILED: "Cleaning needs attention", JOB_CANCELLED: "Auction cancelled", AUCTION_UNAWARDED: "No eligible offer",
  PAYMENT_CLAIMED: "Payment started", WORKFLOW_PAUSED: "Work paused", WORKFLOW_RESUMED: "Work resumed", DEADLINE_REVIEW: "Deadline needs review",
};
export function eventLabel(type: string) { return eventLabels[type] ?? "Marketplace update"; }
export function eventTone(type: string): StepTone {
  if (["WORK_APPROVED","DELIVERABLE_SUBMITTED","DELIVERABLE_RELEASED"].includes(type)) return "done";
  if (["EXECUTION_REQUIRES_REVIEW","AWAITING_OWNER_REVIEW","DEPENDENCY_FAILED","DEADLINE_REVIEW","WORKFLOW_PAUSED"].includes(type)) return "attention";
  if (["WORK_REJECTED","JOB_CANCELLED","AUCTION_UNAWARDED"].includes(type)) return "stopped";
  return "current";
}
export function recentMetrics(jobs: readonly WorkJob[], payments: readonly { status: string; amountYocto: string }[]) {
  const roots = jobs.filter((job) => !job.parentId);
  return {
    active: roots.filter((job) => ["bidding","working","revision","verifying"].includes(job.state)).length,
    review: new Set(jobs.filter((job) => job.state === "disputed").map((job) => job.missionId)).size,
    approved: roots.filter((job) => job.state === "approved").length,
    rejected: roots.filter((job) => ["rejected","unawarded","cancelled"].includes(job.state)).length,
    confirmedYocto: payments.filter((p) => p.status === "CONFIRMED").reduce((sum,p) => sum + BigInt(p.amountYocto), 0n).toString(),
  };
}

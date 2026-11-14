"use client";
import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { DeliverablePanel } from "@/components/deliverable-panel";
import { formatNear } from "@/lib/money";
import { SERVICE_LABELS } from "@/lib/services";

export default function MasterAgentRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const runId = id as Id<"masterAgentRuns">;
  const token = useAuthToken();

  const data = useQuery(api.masterAgent.getRun, { runId });
  const settlementStatus = useQuery(api.payments.status, {});

  const submitClarification = useMutation(api.masterAgent.submitClarification);
  const retryPlanning = useMutation(api.masterAgent.retryPlanning);
  const acceptAndExecute = useMutation(api.masterAgent.acceptAndExecutePlan);
  const createGrant = useMutation(api.spendingGrants.create);
  const revokeGrant = useMutation(api.spendingGrants.revoke);
  const authorizeEligiblePayments = useMutation(api.masterAgent.authorizeEligibleStepPayments);
  const resolveDispute = useMutation(api.jobs.resolveDispute);
  const cancelRun = useMutation(api.masterAgent.cancelRun);

  const [clarificationText, setClarificationText] = useState("");
  const [allowPreview, setAllowPreview] = useState(false);
  const [disputeReason, setDisputeReason] = useState("Owner reviewed objective verification and acceptance notes.");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  if (data === undefined) {
    return (
      <main className="p-8" role="status">
        Loading Master Agent run…
      </main>
    );
  }

  const { run, plan, grant, grantReservations, steps } = data;

  async function triggerLocalPlanner(requestId: string) {
    if (!token) {
      setErrorMessage("Sign in again to invoke the local Ollama planner.");
      return;
    }
    const res = await fetch("/api/master-agent/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        runId: run._id,
        requestId,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; message?: string; validationError?: { message?: string } };
    if (!res.ok && json.message) {
      setErrorMessage(json.message);
    }
  }

  async function handleClarificationSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("clarify");
    try {
      const next = await submitClarification({
        runId: run._id,
        clarificationResponse: clarificationText.trim(),
      });
      await triggerLocalPlanner(next.requestId);
      setClarificationText("");
      setActionMessage("Clarification submitted and re-planned with local Qwen3.5 4B.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not submit clarification.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryPlan() {
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("retry");
    try {
      const next = await retryPlanning({ runId: run._id });
      await triggerLocalPlanner(next.requestId);
      setActionMessage("Re-ran local Qwen3.5 4B planning.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not retry planning.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAcceptPlan() {
    if (!run.planHash) return;
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("accept");
    try {
      await acceptAndExecute({
        runId: run._id,
        planVersion: run.planVersion,
        planHash: run.planHash,
        allowUnfundedPreview: allowPreview || run.allowUnfundedPreview,
      });
      setActionMessage("Plan compiled into private missions and auctions opened.");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not accept plan. If settlement is not configured, acknowledge metadata-only preview first.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateGrant() {
    if (!run.planHash || !plan?.proposedTotalBudgetYocto) return;
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("grant");
    try {
      await createGrant({
        runId: run._id,
        planVersion: run.planVersion,
        planHash: run.planHash,
        maxTransferYocto: plan.proposedTotalBudgetYocto,
        confirm: "AUTHORIZE_SCOPED_RUN_SPENDING",
      });
      await authorizeEligiblePayments({ runId: run._id });
      setActionMessage("Scoped human spending grant created and eligible approved payments authorized.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not create spending grant.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAuthorizePayments() {
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("settle");
    try {
      const res = await authorizeEligiblePayments({ runId: run._id });
      const count = res.results.filter((r) => r.ok).length;
      setActionMessage(
        count > 0
          ? `Authorized ${count} eligible payment intent${count === 1 ? "" : "s"} under your active grant.`
          : "Checked all step obligations; no additional approved ready intents needed authorization.",
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not authorize step payments.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevokeGrant() {
    if (!grant) return;
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("revoke");
    try {
      await revokeGrant({ grantId: grant._id });
      setActionMessage("Spending grant revoked. No new payment authorizations or claims can proceed.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not revoke grant.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancelRun() {
    setErrorMessage("");
    setActionMessage("");
    setBusyAction("cancel");
    try {
      await cancelRun({ runId: run._id });
      setActionMessage("Run cancelled and any active grant revoked.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not cancel run.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">
            <Link href="/master-agent" className="underline">
              Master Agent
            </Link>{" "}
            · Plan v{run.planVersion}
          </p>
          <h1>{run.title}</h1>
          <p className="muted text-sm mt-2">{run.prompt}</p>
          {run.clarificationResponse && (
            <p className="text-sm mt-1">
              <strong>Owner clarification:</strong> {run.clarificationResponse}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`outcome-pill ${run.state === "completed" ? "approved" : ""}`}>
            {run.state}
          </span>
          {!["completed", "cancelled"].includes(run.state) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCancelRun()}
              disabled={busyAction !== null}
            >
              Cancel run
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="panel text-red-800 text-sm font-medium">
          {errorMessage}
        </p>
      )}
      {actionMessage && (
        <p role="status" className="panel text-sm font-medium">
          {actionMessage}
        </p>
      )}

      <section className="panel">
        <p className="eyebrow">Trusted request envelope</p>
        <h2 className="mt-1">Datasets & limits</h2>
        <div className="grid gap-4 md:grid-cols-3 mt-3 text-sm">
          <div>
            <strong>Max budget cap:</strong> {formatNear(run.maxBudgetYocto)} NEAR (
            <code>{run.maxBudgetYocto}</code> yoctoNEAR)
          </div>
          <div>
            <strong>Deadline:</strong> {new Date(run.deadlineAt).toLocaleString()}
          </div>
          <div>
            <strong>Human review policy:</strong>{" "}
            {run.requiresHumanReview ? "Required on all steps" : "Objective verification unless step requests review"}
          </div>
        </div>
        <div className="mt-3 space-y-2 text-xs">
          {run.datasets.map((ds) => (
            <div key={ds.ref} className="rounded border p-2">
              <strong>
                Dataset <code>{ds.ref}</code> ({ds.name})
              </strong>{" "}
              · {ds.rowCount} rows · {ds.byteLength} bytes · Headers:{" "}
              <code>{ds.headers.join(", ")}</code> · SHA-256: <code>{ds.sha256.slice(0, 16)}…</code>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Local Ollama Qwen3.5 4B proposal</p>
            <h2 className="mt-1">
              {plan
                ? `Decision: ${plan.decision.toUpperCase()}`
                : run.state === "planning"
                  ? "Planning in progress…"
                  : "No validated plan"}
            </h2>
          </div>
          {run.stepRecords.length === 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRetryPlan()}
              disabled={busyAction !== null}
            >
              {busyAction === "retry" ? "Re-planning…" : "Re-run local planner"}
            </Button>
          )}
        </div>

        {run.inferenceEnvelope && (
          <p className="muted text-xs mt-2">
            Provider: <code>{run.inferenceEnvelope.provider}</code> · Model:{" "}
            <code>{run.inferenceEnvelope.model}</code>
            {run.inferenceEnvelope.modelDigest
              ? ` (${run.inferenceEnvelope.modelDigest.slice(0, 12)}…)`
              : ""}{" "}
            · Latency: {run.inferenceEnvelope.durationMs} ms
            {run.inferenceEnvelope.promptEvalCount !== undefined
              ? ` · Prompt tokens: ${run.inferenceEnvelope.promptEvalCount}`
              : ""}
            {run.inferenceEnvelope.evalCount !== undefined
              ? ` · Output tokens: ${run.inferenceEnvelope.evalCount}`
              : ""}{" "}
            · Schema SHA-256: <code>{run.inferenceEnvelope.schemaSha256.slice(0, 12)}…</code>
          </p>
        )}

        {run.validationError && (
          <div role="alert" className="mt-4 rounded border border-red-300 p-3 text-sm text-red-900">
            <strong>{run.validationError.code}:</strong> {run.validationError.message}
          </div>
        )}

        {plan && (
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              <strong>Planner summary:</strong> {plan.summary}
            </p>
            {plan.reasonCodes.length > 0 && (
              <p className="text-xs muted">
                Reason codes: <code>{plan.reasonCodes.join(", ")}</code>
              </p>
            )}
            {plan.proposedTotalBudgetYocto && (
              <p className="text-sm">
                <strong>Proposed total step budget:</strong>{" "}
                {formatNear(plan.proposedTotalBudgetYocto)} NEAR (
                <code>{plan.proposedTotalBudgetYocto}</code> yoctoNEAR)
              </p>
            )}

            {plan.questions.length > 0 && (
              <div className="rounded border p-4 space-y-2">
                <h3 className="text-sm font-semibold">Clarification questions</h3>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {plan.questions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {plan.steps.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Proposed deterministic steps</h3>
                {plan.steps.map((s) => (
                  <div key={s.stepId} className="rounded border p-3 text-sm space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>
                        Step <code>{s.stepId}</code> · {s.title}
                      </strong>
                      <span className="outcome-pill">
                        {SERVICE_LABELS[s.serviceType]} · Max {formatNear(s.maxBudgetYocto)} NEAR
                      </span>
                    </div>
                    <p className="text-xs muted">
                      Dataset: <code>{s.datasetRef}</code>
                      {s.comparisonDatasetRef ? ` vs ${s.comparisonDatasetRef}` : ""} · Columns:{" "}
                      <code>{s.options.columns.join(", ")}</code>
                      {s.options.caseMode ? ` · Case: ${s.options.caseMode}` : ""}
                      {s.options.numericColumns
                        ? ` · Numeric check: ${s.options.numericColumns.join(", ") || "none"}`
                        : ""}
                      {s.options.keyColumn ? ` · Key: ${s.options.keyColumn}` : ""}
                      {s.options.groupBy ? ` · Group by: ${s.options.groupBy}` : ""}
                      {s.cleanBeforeProcessing ? " · Includes 1-level cleaning subcontract" : ""}
                    </p>
                    <p className="text-xs muted">Acceptance criteria: {s.acceptanceCriteria}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {run.stepRecords.length === 0 &&
          (run.state === "needs_clarification" || run.state === "failed" || run.state === "ready") && (
            <form onSubmit={(e) => void handleClarificationSubmit(e)} className="mt-5 space-y-3 border-t pt-4">
              <label htmlFor="clarification-input" className="block text-sm font-semibold">
                Provide clarification or refine instructions
              </label>
              <textarea
                id="clarification-input"
                value={clarificationText}
                onChange={(e) => setClarificationText(e.target.value)}
                rows={2}
                maxLength={1000}
                required
                placeholder="Example: Define success by existing revenue column and run a grouped numeric report by product."
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <Button type="submit" variant="outline" disabled={busyAction !== null}>
                {busyAction === "clarify" ? "Re-planning…" : "Submit clarification & re-plan"}
              </Button>
            </form>
          )}

        {run.state === "ready" && run.stepRecords.length === 0 && (
          <div className="mt-5 border-t pt-4 space-y-3">
            {settlementStatus && !settlementStatus.enabled && !run.allowUnfundedPreview && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowPreview}
                  onChange={(e) => setAllowPreview(e.target.checked)}
                />
                <span>
                  Acknowledge metadata-only delivery (settlement is not configured; full outputs remain locked until testnet payments confirm)
                </span>
              </label>
            )}
            <Button
              type="button"
              onClick={() => void handleAcceptPlan()}
              disabled={busyAction !== null}
            >
              {busyAction === "accept"
                ? "Compiling missions & opening auctions…"
                : "Accept Plan & Launch Private Auctions"}
            </Button>
          </div>
        )}
      </section>

      {run.stepRecords.length > 0 && (
        <section className="panel" aria-label="Human mission-scoped spending authorization">
          <p className="eyebrow">2 · Human financial authority</p>
          <h2 className="mt-1">Scoped Run Spending Grant</h2>
          <p className="muted text-sm mt-1">
            The local LLM is a planner, never financial authority. Authorizing this bundle grant permits exact
            settlement only for the approved deliverables of the bound missions below, up to{" "}
            <strong>
              {formatNear(plan?.proposedTotalBudgetYocto ?? run.maxBudgetYocto)} testnet NEAR
            </strong>
            . Network gas is covered separately by the shared operator reserve (0.01 NEAR admission reserve).
          </p>

          <div className="mt-3 rounded border p-3 text-xs space-y-1">
            <p>
              <strong>Bound Plan Hash:</strong> <code>{run.planHash}</code> (v{run.planVersion})
            </p>
            <p>
              <strong>Bound Missions:</strong>{" "}
              {run.stepRecords.map((s) => `${s.stepId} (${s.serviceType})`).join(", ")}
            </p>
            {grant ? (
              <>
                <p>
                  <strong>Grant Status:</strong>{" "}
                  {grant.isRevoked
                    ? "REVOKED"
                    : grant.isExpired
                      ? "EXPIRED"
                      : "ACTIVE"}{" "}
                  · Max transfer cap: {formatNear(grant.maxTransferYocto)} NEAR · Reserved:{" "}
                  {formatNear(grant.reservedYocto)} NEAR · Separate gas reserve disclosure:{" "}
                  {formatNear(grant.gasReserveDisclosureYocto)} NEAR
                </p>
                <p>
                  <strong>Operator account:</strong> <code>{grant.operatorAccount}</code> · Expires:{" "}
                  {new Date(grant.expiresAt).toLocaleString()} · Linked intent reservations:{" "}
                  {grantReservations.length}
                </p>
              </>
            ) : (
              <p>
                <strong>Grant Status:</strong> Not yet granted. Work can execute and verify, but automatic settlement waits for your explicit grant or manual receipt approval.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            {(!grant || grant.isRevoked || grant.isExpired) && settlementStatus?.enabled && (
              <Button
                type="button"
                onClick={() => void handleCreateGrant()}
                disabled={busyAction !== null}
              >
                {busyAction === "grant"
                  ? "Creating scoped grant…"
                  : `Grant one-time spending authority (${formatNear(plan?.proposedTotalBudgetYocto ?? run.maxBudgetYocto)} NEAR)`}
              </Button>
            )}
            {grant && !grant.isRevoked && !grant.isExpired && (
              <>
                <Button
                  type="button"
                  onClick={() => void handleAuthorizePayments()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "settle"
                    ? "Checking step obligations…"
                    : "Authorize eligible approved step payments"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleRevokeGrant()}
                  disabled={busyAction !== null}
                >
                  Revoke spending grant
                </Button>
              </>
            )}
            {!settlementStatus?.enabled && (
              <p className="muted text-xs">
                Testnet settlement is currently disabled on the backend. Metadata previews and objective verification run normally; full outputs remain locked until settlement is configured and confirmed.
              </p>
            )}
          </div>
        </section>
      )}

      {steps.length > 0 && (
        <section className="space-y-6">
          <div>
            <p className="eyebrow">3 · Marketplace execution & released outputs</p>
            <h2 className="mt-1">Compiled Step Missions ({steps.length})</h2>
          </div>

          {steps.map(({ step, jobDetail, rootPayment, childPayment, childContract }) => {
            const job = jobDetail?.job;
            const contract = jobDetail?.contracts[0];
            const childJob = jobDetail?.children[0];
            const openDispute = jobDetail?.disputes.find((d) => !d.decision);
            const latestDeliverable = jobDetail?.deliverables.find((d) => d.isLatest);

            return (
              <div key={step.stepId} className="panel space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">
                      Step <code>{step.stepId}</code> · {SERVICE_LABELS[step.serviceType]}
                    </p>
                    <h3 className="mt-1 font-semibold">{step.title}</h3>
                    <p className="muted text-xs mt-1">
                      Step cap: {formatNear(step.maxBudgetYocto)} NEAR ·{" "}
                      <Link href={`/missions/${step.missionId}`} className="underline">
                        Open mission workspace
                      </Link>
                    </p>
                  </div>
                  <span className={`outcome-pill ${job?.state === "approved" ? "approved" : ""}`}>
                    {job?.state ?? "pending"}
                  </span>
                </div>

                {jobDetail && (
                  <div className="grid gap-3 md:grid-cols-4 text-xs">
                    <div className="rounded border p-2">
                      <strong>Bids & negotiation:</strong> {jobDetail.bids.length} offers ·{" "}
                      {jobDetail.negotiations.length} negotiation turns
                    </div>
                    <div className="rounded border p-2">
                      <strong>Awarded contract:</strong>{" "}
                      {contract
                        ? `${contract.agentId} (${formatNear(contract.amountYocto)} NEAR total, ${formatNear(contract.holdbackYocto)} NEAR parent payable)`
                        : "Pending award"}
                    </div>
                    <div className="rounded border p-2">
                      <strong>Subcontract (depth 1):</strong>{" "}
                      {childJob
                        ? `${childJob.state}${childContract ? ` · ${childContract.agentId} (${formatNear(childContract.amountYocto)} NEAR)` : ""}`
                        : step.cleanBeforeProcessing
                          ? "Scheduled on parent award"
                          : "None"}
                    </div>
                    <div className="rounded border p-2">
                      <strong>Settlement & release:</strong>{" "}
                      {jobDetail.delivery.confirmedPayments} of{" "}
                      {jobDetail.delivery.requiredPayments} confirmed ·{" "}
                      {jobDetail.delivery.released ? "Released" : "Locked"}
                      {rootPayment ? ` (${rootPayment.status})` : ""}
                      {childPayment ? ` / child (${childPayment.status})` : ""}
                    </div>
                  </div>
                )}

                {openDispute && job && (
                  <div className="rounded border p-4 space-y-3">
                    <p className="text-sm font-semibold">Human review / dispute resolution required</p>
                    <p className="text-xs muted">{openDispute.reason}</p>
                    <input
                      type="text"
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      className="w-full rounded border px-3 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={async () => {
                          setBusyAction(`approve-${job._id}`);
                          try {
                            await resolveDispute({
                              id: job._id,
                              decision: "approve",
                              reason: disputeReason,
                            });
                          } finally {
                            setBusyAction(null);
                          }
                        }}
                        disabled={busyAction !== null || !latestDeliverable}
                      >
                        Approve work
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          setBusyAction(`reject-${job._id}`);
                          try {
                            await resolveDispute({
                              id: job._id,
                              decision: "reject",
                              reason: disputeReason,
                            });
                          } finally {
                            setBusyAction(null);
                          }
                        }}
                        disabled={busyAction !== null}
                      >
                        Reject work
                      </Button>
                    </div>
                  </div>
                )}

                {latestDeliverable && jobDetail && (
                  <DeliverablePanel
                    deliverable={latestDeliverable}
                    delivery={jobDetail.delivery}
                    approved={job?.state === "approved"}
                  />
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

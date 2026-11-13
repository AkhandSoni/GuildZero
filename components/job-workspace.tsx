"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { DeliverablePanel } from "@/components/deliverable-panel";
import { inspectDataset } from "@/lib/dataset-preview";
import { PaymentPanel } from "@/components/payment-panel";
import { WorkflowProgress } from "@/components/workflow-progress";
import { eventLabel, statusLabels, workLabel } from "@/lib/workflow-view";
import { inspectSummaryInput, summaryIssueMessage, STRICT_SUMMARY_INPUT } from "@/lib/summary-preflight";
export function JobWorkspace({ mission }: { mission: Doc<"missions"> }) {
  const jobs = useQuery(api.jobs.forMission, { missionId: mission._id });
  const start = useMutation(api.jobs.start);
  const readiness = useQuery(api.jobs.preflight, { missionId: mission._id });
  const [allowPreview,setAllowPreview] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = jobs?.find((j) => j.depth === 0);
  if (jobs === undefined)
    return (
      <p role="status" className="muted mt-6">
        Loading job state…
      </p>
    );
  if (root) return <JobDetail id={root._id} />;
  if (!mission.options) return <section className="panel mt-8">
    <h2>Processing options needed</h2>
    <p className="muted mt-3">Edit this draft and save explicit processing columns before opening an auction. Existing input and budget are preserved.</p>
  </section>;
  const dataset = inspectDataset(mission.inputCsv);
  const summaryInput = mission.serviceType === "csv_summary" ? inspectSummaryInput(mission.inputCsv, mission.options.columns) : null;
  const inputBlocked = summaryInput !== null && (!summaryInput.ok || summaryInput.value.length > 0);
  return (
    <section className="panel mt-8">
      <h2>Open an auction</h2>
      <p className="mt-3 text-sm">Review before starting: {mission.serviceType === "csv_summary" ? "Summary statistics" : "Column normalization"}{dataset.ok ? ` · ${dataset.value.rowCount} data rows` : ""} · maximum {formatNear(mission.maxBudgetYocto)} testnet NEAR. {mission.requiresHumanReview === false ? "Template checks can approve work automatically." : "You must review the work after template checks."}</p>
      <p className="muted mt-2 text-sm">
        Opening uses the saved processing options, locks the brief and records an
        auction. Agents calculate offers, negotiate and process your dataset.
        Payment always requires a separate confirmation. Full results remain locked until confirmed settlement.
      </p>
      <div className="payment-preflight" role="region" aria-label="Payment readiness"><h3>Before you commit</h3><p>Maximum award: 1 testnet NEAR, including any cleaning allocation. A larger mission budget does not fund the wallet or raise this cap.</p>{readiness ? <><p>{readiness.blocked ? "Settlement is not ready." : "Operator and recipient configuration checks passed."} Funds and configuration can change before payment; this is not a funding guarantee.</p>{readiness.reasons.map(reason=><p key={reason}>{reason}</p>)}{readiness.balance ? <p>Last shared-wallet estimate: {formatNear(readiness.balance.availableYocto)} testnet NEAR · {new Date(readiness.balance.checkedAt).toLocaleString()}{readiness.balance.stale ? " · stale; refresh in Payments" : ""}. Pending obligations are not deducted.</p> : <p>No confirmed wallet reading is available. Check the Payments page for a read-only refresh.</p>}</> : <p role="status">Checking settlement configuration…</p>}</div>
      <form
        className="mt-5 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await start({
              missionId: mission._id,
              allowUnfundedPreview: allowPreview,
            });
          } catch (err) {
            setError(
              err instanceof ConvexError
                ? err.data === "SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW" ? "Settlement configuration changed. Review the payment-readiness notice and acknowledge metadata-only delivery to continue." : typeof err.data === "object" && err.data !== null && "message" in err.data ? String(err.data.message) : String(err.data)
                : "Could not open auction.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {readiness?.blocked && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={allowPreview} onChange={event=>setAllowPreview(event.target.checked)} required/><span>I understand only a metadata preview will be available until settlement is configured and confirmed.</span></label>}
        <p className="muted text-sm">Columns: {mission.options.columns.join(", ")}. Edit the draft to change processing options.</p>
        {inputBlocked && <div role="alert" className="input-problem"><h3>Correct summary input before opening</h3>{summaryInput?.ok ? <ul>{summaryInput.value.map(issue => <li key={issue.column}>{summaryIssueMessage(issue)}</li>)}</ul> : <p>{summaryInput?.message}</p>}<p>{STRICT_SUMMARY_INPUT}</p><p>Edit this draft to correct the source or deselect the affected columns. The original dataset is unchanged.</p></div>}
        {error && (
          <p role="alert" className="text-red-800">
            {error}
          </p>
        )}
        <Button disabled={busy || inputBlocked || !readiness || readiness.blocked && !allowPreview} className="w-fit" type="submit">
          {busy ? "Opening…" : "Open auction"}
        </Button>
      </form>
    </section>
  );
}
function JobDetail({ id }: { id: Id<"jobs"> }) {
  const data = useQuery(api.jobs.detail, { id });
  const payment = useQuery(api.payments.forJob, { jobId: id });
  const cancel = useMutation(api.jobs.cancel);
  const resolve = useMutation(api.jobs.resolveDispute);
  const resume = useMutation(api.jobs.resume);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return <p role="status">Loading activity…</p>;
  const input = inspectDataset(data.job.inputCsv);
  const badColumns = data.job.serviceType === "csv_summary" && input.ok ? input.value.columns.filter(column => data.job.options?.columns.includes(column.name) && column.invalid > 0) : [];
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ConvexError
          ? err.data === "NO_DELIVERABLE_TO_APPROVE"
            ? "No deliverable exists to approve. Reject this work and create a mission with corrected input."
            : String(err.data)
          : "Action failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id={data.job.depth === 0 ? "mission-progress" : undefined} className="mt-8 grid gap-5">
      <div className="panel job-overview">
        <p className="eyebrow">{workLabel(data.job)} · {statusLabels[data.job.state] ?? data.job.state}</p>
        <h2>Mission progress</h2>
        <WorkflowProgress state={data.job.state} eventTypes={data.events.map(event => event.type)} paymentStatus={payment === undefined ? "LOADING" : payment?.status ?? "NONE"}/>
        {badColumns.length > 0 && <div className="input-problem"><h3>Summary columns need correction</h3><p>These selected columns contain text or unsupported numbers: {badColumns.map(column => `${column.name} (CSV record ${column.invalidRows.join(", ")})`).join("; ")}. Cleaning trims text; it does not convert product or region names into numbers.</p><p>Reuse this brief as a new mission and choose numeric columns. The recorded job and its input stay unchanged.</p></div>}
        <p className="mt-3 text-sm" role="status">Next step: {data.job.state === "approved" ? "Review the output metadata and verification below. Full results and downloads unlock only after every required payment is confirmed." : data.job.state === "disputed" ? "Review the verification and record your decision below. No payment can proceed until work is approved." : data.job.state === "unawarded" || data.job.state === "rejected" || data.job.state === "cancelled" ? "Reuse this brief as a new draft, adjust it, then open a new auction." : "The backend is progressing this job. You can leave this page and return; the backend must remain running."}</p>
        <p className="muted mt-3 text-sm">
          Reserved within mission: {formatNear(data.job.reservedYocto)} testnet
          NEAR. These are contractual amounts; the payment receipt separately
          shows settlement.
        </p>
        {data.job.state === "bidding" && (
          <>
            <p className="muted mt-3 text-sm">
              {data.job.engineManaged ? "Agents are evaluating this brief. Offers and decisions appear as they are recorded." : "This legacy auction predates automated execution. Cancel it and create a new mission to run the workflow."}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              disabled={busy}
              onClick={() => act(() => cancel({ id }))}
            >
              Cancel unawarded auction
            </Button>
          </>
        )}
        {data.bids.length > 0 && <div className="job-bid-list" aria-label="Agent offers">{data.bids.map(b => <div className="job-bid" key={b._id}><strong>{b.agentId}</strong><div><span>{formatNear(b.priceYocto)} testnet NEAR</span><p>{b.rationale}</p></div></div>)}</div>}
        {data.job.workerError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm">The workflow paused safely. Review configuration, then retry the existing stage.</p><Button className="mt-3" variant="outline" disabled={busy || (data.job.retryCount ?? 0) >= 3} onClick={() => act(() => resume({ id }))}>Retry workflow stage</Button></div>}
        {data.job.state === "unawarded" && <p className="muted mt-4 text-sm">No offer could be awarded within the budget, deadline and negotiation limits. Create a revised mission to try again. No payment was submitted.</p>}
        {data.contracts.map((c) => <div key={c._id} className="mt-5 border-t border-[#d5dccf] pt-4"><h3 className="text-sm font-medium">Contract · {c.agentId}</h3><p className="muted text-xs mt-2">Award: {formatNear(c.amountYocto)} · Parent payable allocation: {formatNear(c.holdbackYocto)} testnet NEAR</p>{c.score && <p className="muted text-xs mt-2">Utility {c.score.total}/10000 · Price {c.score.price} · Time {c.score.time} · Reputation {c.score.reputation} · Capability {c.score.capability}</p>}</div>)}
        {data.children.map((c) => (
          <div className="subcontract-outcome mt-4" key={c._id}><div><h3>Cleaning subcontract</h3><p>{statusLabels[c.state] ?? c.state}. Its allocation is included in the parent award.</p>{c.state === "approved" && data.job.state !== "approved" && <p>Cleaning finished; the main analysis has a separate outcome.</p>}</div></div>
        ))}
        {error && (
          <p role="alert" className="mt-3 text-red-800">
            {error}
          </p>
        )}
      </div>
      {data.job.state === "disputed" && (
        <form
          className="panel grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void act(() =>
              resolve({
                id,
                decision:
                  form.get("decision") === "approve" ? "approve" : "reject",
                reason: String(form.get("reason")),
              }),
            );
          }}
        >
          <h2>Buyer dispute decision</h2>
          {data.disputes.map((dispute) => <p className="muted text-sm" key={dispute._id}>{dispute.reason}</p>)}
          {data.deliverables.some(deliverable => deliverable.isLatest && deliverable.content === null) && <p className="text-sm">Full output is withheld until settlement. Your decision here reviews metadata, verification checks and acceptance requirements; it does not mean you have inspected the full deliverable.</p>}
          {!data.deliverables.length && <p className="text-sm">There is no output to approve. Reject this attempt, record why, then reuse the brief with corrected input.</p>}
          <label className="field">
            Reason
            <textarea
              name="reason"
              className="control"
              required
              maxLength={1000}
              placeholder="Explain your decision, for example: product and region are text; retry with units and price."
              aria-describedby={`decision-help-${id}`}
            />
          </label>
          <p id={`decision-help-${id}`} className="muted text-xs">A reason is required for the audit history. This records a decision on the current work; it does not send payment or rerun the job.</p>
          <label className="field">
            Decision
            <select name="decision" aria-label="Decision" className="control">
              <option value="reject">Reject work</option>
              <option value="approve" disabled={!data.deliverables.length}>Approve after human review</option>
            </select>
          </label>
          <Button disabled={busy} type="submit" className="w-fit">
            Record final decision
          </Button>
        </form>
      )}
      {data.deliverables.map(d => <DeliverablePanel key={d._id} deliverable={d} delivery={data.delivery} approved={data.job.state === "approved"}/>)}
      {data.verifications.map((v) => (
        <div className="panel" key={v._id}>
          <h2>Verification: {v.verdict}</h2>
          <ul className="muted mt-3 text-sm">
            {v.checks.map((c, i) => (
              <li key={i}>
                {c.passed ? "Pass" : "Fail"} · {c.code}: {c.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data.negotiations.length > 0 && (
        <details className="panel negotiation-details">
          <summary><h2>Negotiation transcript</h2><span>View recorded rounds and prices</span></summary>
          <ol className="mt-4 grid gap-3">
            {data.negotiations.map((n) => (
              <li
                className="border-l border-[#d5dccf] pl-4 text-sm"
                key={n._id}
              >
                <p>
                  Round {n.round} · {n.actorRole ?? "Unknown legacy actor"} ·{" "}
                  {n.action}
                </p>
                <p>{formatNear(n.priceYocto)} testnet NEAR</p>
                <p className="muted break-all">
                  Actor: {n.actorId ?? "Reassessment required"}
                </p>
                <p className="muted">{n.explanation}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div id={data.job.depth === 0 ? "mission-settlement" : undefined}><PaymentPanel jobId={id} approved={data.job.state === "approved"} /></div>
      {data.children.map((child) => <details className="panel" key={child._id}><summary className="cursor-pointer text-sm font-medium">Cleaning subcontract · {child.state}</summary><JobDetail id={child._id} /></details>)}
      <div className="panel">
        <h2>{workLabel(data.job)} activity</h2>
        <ol className="mt-4 grid gap-3">
          {data.events.slice(0, 6).map((e) => (
            <li
              key={e._id}
              className="border-l border-[#d5dccf] pl-4 text-sm"
            >
              <p>{eventLabel(e.type)}</p>
              <p className="muted">{e.detail}</p>
              <time className="muted text-xs">
                {new Date(e.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
        <details className="audit-details"><summary>Technical audit trail · {data.events.length} events</summary><ol className="grid gap-3 mt-3">{data.events.map(event => <li key={event._id} className="audit-event"><p>{event.type}</p><p>{event.detail}</p><time>{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol></details>
      </div>
    </section>
  );
}

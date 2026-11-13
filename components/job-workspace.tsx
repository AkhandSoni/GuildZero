"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { ResultPreview } from "@/components/result-preview";
import { inspectDataset } from "@/lib/dataset-preview";
import { PaymentPanel } from "@/components/payment-panel";
import Papa from "papaparse";
import { isUnsafeFormulaValue } from "@/lib/economy/csv-input";
function safeCsv(content: string) {
  const parsed = Papa.parse<string[]>(content, { delimiter: ",", skipEmptyLines: false });
  return !parsed.errors.length && parsed.data.every((row) => row.every((cell) => !isUnsafeFormulaValue(cell)));
}
export function JobWorkspace({ mission }: { mission: Doc<"missions"> }) {
  const jobs = useQuery(api.jobs.forMission, { missionId: mission._id });
  const start = useMutation(api.jobs.start);
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
  return (
    <section className="panel mt-8">
      <h2>Open an auction</h2>
      <p className="mt-3 text-sm">Review before starting: {mission.serviceType === "csv_summary" ? "Summary statistics" : "Column normalization"}{dataset.ok ? ` · ${dataset.value.rowCount} data rows` : ""} · maximum {formatNear(mission.maxBudgetYocto)} testnet NEAR. {mission.requiresHumanReview === false ? "Template checks can approve work automatically." : "You must review the work after template checks."}</p>
      <p className="muted mt-2 text-sm">
        Opening uses the saved processing options, locks the brief and records an
        auction. Agents calculate offers, negotiate and process your dataset.
        Payment always requires a separate confirmation.
      </p>
      <form
        className="mt-5 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await start({
              missionId: mission._id,
            });
          } catch (err) {
            setError(
              err instanceof ConvexError
                ? typeof err.data === "object" && err.data !== null && "message" in err.data ? String(err.data.message) : String(err.data)
                : "Could not open auction.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted text-sm">Columns: {mission.options.columns.join(", ")}. Edit the draft to change processing options.</p>
        {error && (
          <p role="alert" className="text-red-800">
            {error}
          </p>
        )}
        <Button disabled={busy} className="w-fit" type="submit">
          {busy ? "Opening…" : "Open auction"}
        </Button>
      </form>
    </section>
  );
}
function JobDetail({ id }: { id: Id<"jobs"> }) {
  const data = useQuery(api.jobs.detail, { id });
  const cancel = useMutation(api.jobs.cancel);
  const resolve = useMutation(api.jobs.resolveDispute);
  const resume = useMutation(api.jobs.resume);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return <p role="status">Loading activity…</p>;
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
    <section className="mt-8 grid gap-5">
      <div className="panel">
        <p className="eyebrow">Persisted job · {data.job.state}</p>
        <h2>Marketplace activity</h2>
        <p className="mt-3 text-sm" role="status">Next step: {data.job.state === "approved" ? "Review your verified result below. Payment is separate and still requires your confirmation." : data.job.state === "disputed" ? "Review the verification and record your decision below. No payment can proceed until work is approved." : data.job.state === "unawarded" || data.job.state === "rejected" || data.job.state === "cancelled" ? "Reuse this brief as a new draft, adjust it, then open a new auction." : "The backend is progressing this job. You can leave this page and return; the backend must remain running."}</p>
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
        {data.bids.map((b) => (
          <p className="mt-3 text-sm" key={b._id}>
            {b.agentId}: {formatNear(b.priceYocto)} testnet NEAR · {b.rationale}
          </p>
        ))}
        {data.job.workerError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm">The workflow paused safely. Review configuration, then retry the existing stage.</p><Button className="mt-3" variant="outline" disabled={busy || (data.job.retryCount ?? 0) >= 3} onClick={() => act(() => resume({ id }))}>Retry workflow stage</Button></div>}
        {data.job.state === "unawarded" && <p className="muted mt-4 text-sm">No offer could be awarded within the budget, deadline and negotiation limits. Create a revised mission to try again. No payment was submitted.</p>}
        {data.contracts.map((c) => <div key={c._id} className="mt-5 border-t border-[#d5dccf] pt-4"><h3 className="text-sm font-medium">Contract · {c.agentId}</h3><p className="muted text-xs mt-2">Award: {formatNear(c.amountYocto)} · Parent payable allocation: {formatNear(c.holdbackYocto)} testnet NEAR</p>{c.score && <p className="muted text-xs mt-2">Utility {c.score.total}/10000 · Price {c.score.price} · Time {c.score.time} · Reputation {c.score.reputation} · Capability {c.score.capability}</p>}</div>)}
        {data.contracts.map((c) => (
          <div className="mt-3 text-sm" key={c._id}>
            <p>
              Award: {c.agentId} · {formatNear(c.amountYocto)} testnet NEAR
            </p>
            <p className="muted">{c.selectionReason}</p>
          </div>
        ))}
        {data.children.map((c) => (
          <p className="muted mt-3 text-sm" key={c._id}>
            Normalization subcontract: {c.state}. Allocation is contained within
            the parent award.
          </p>
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
          <label className="field">
            Reason
            <textarea
              name="reason"
              className="control"
              required
              maxLength={1000}
            />
          </label>
          <label className="field">
            Decision
            <select name="decision" aria-label="Decision" className="control">
              <option value="reject">Reject work</option>
              <option value="approve">Approve after human review</option>
            </select>
          </label>
          <Button disabled={busy} type="submit" className="w-fit">
            Record final decision
          </Button>
        </form>
      )}
      {data.deliverables.map((d) => (
        <div className="panel min-w-0" key={d._id}>
          <h2>Deliverable · attempt {d.attempt + 1}</h2>
          <ResultPreview content={d.content} format={d.format} />
          <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap text-xs">
            {d.content}
          </pre>
          {d.format === "json" && (
            <Button asChild className="mt-3" variant="outline">
              <a
                download="guildzero-summary.json"
                href={`data:application/json;charset=utf-8,${encodeURIComponent(d.content)}`}
              >
                Download JSON
              </a>
            </Button>
          )}
          {d.format === "csv" && safeCsv(d.content) && <Button asChild className="mt-3" variant="outline"><a download="guildzero-normalized.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(d.content)}`}>Download CSV</a></Button>}
          {d.format === "csv" && !safeCsv(d.content) && <p className="muted text-xs mt-3">CSV download blocked: unsafe spreadsheet values or invalid CSV.</p>}
        </div>
      ))}
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
        <section className="panel">
          <h2>Negotiation transcript</h2>
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
        </section>
      )}
      <PaymentPanel jobId={id} approved={data.job.state === "approved"} />
      {data.children.map((child) => <details className="panel" key={child._id}><summary className="cursor-pointer text-sm font-medium">Cleaning subcontract · {child.state}</summary><JobDetail id={child._id} /></details>)}
      <div className="panel">
        <h2>Recorded activity</h2>
        <ol className="mt-4 grid gap-3">
          {data.events.map((e) => (
            <li
              key={e._id}
              className="border-l border-[#d5dccf] pl-4 text-sm"
            >
              <p>{e.type}</p>
              <p className="muted">{e.detail}</p>
              <time className="muted text-xs">
                {new Date(e.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

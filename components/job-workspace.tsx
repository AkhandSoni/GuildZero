"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { PaymentPanel } from "@/components/payment-panel";
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
  return (
    <section className="panel mt-8">
      <h2>Open an auction</h2>
      <p className="muted mt-2 text-sm">
        Opening uses the saved processing options, locks the brief and records an
        auction. Automated bidding and execution await the economy engine; no
        work or payments are simulated.
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
          <p role="alert" className="text-red-300">
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
        err instanceof ConvexError ? String(err.data) : "Action failed.",
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
        <p className="muted mt-3 text-sm">
          Reserved within mission: {formatNear(data.job.reservedYocto)} testnet
          NEAR. These are contractual amounts; the payment receipt separately
          shows settlement.
        </p>
        {data.job.state === "bidding" && (
          <>
            <p className="muted mt-3 text-sm">
              Waiting for the execution engine. Bids and work appear only when
              recorded by the trusted worker.
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
          <p role="alert" className="mt-3 text-red-300">
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
            <select name="decision" className="control">
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
        <div className="panel" key={d._id}>
          <h2>Deliverable · attempt {d.attempt + 1}</h2>
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
          <p className="muted mt-3 text-xs">
            CSV download awaits the engine’s spreadsheet-safe exporter.
          </p>
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
                className="border-l border-neutral-700 pl-4 text-sm"
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
      <div className="panel">
        <h2>Recorded activity</h2>
        <ol className="mt-4 grid gap-3">
          {data.events.map((e) => (
            <li
              key={e._id}
              className="border-l border-neutral-700 pl-4 text-sm"
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

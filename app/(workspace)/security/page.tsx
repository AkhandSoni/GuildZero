"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
const probes = [
  { id: "overspend", label: "Over-budget amount" },
  { id: "recipient", label: "Recipient substitution" },
  { id: "duplicate", label: "Duplicate payout" },
  { id: "reputation", label: "Unauthorized reputation write" },
  { id: "subcontract", label: "Excess subcontract depth" },
] as const;
export default function Security() {
  const data = useQuery(api.marketViews.overview, {}),
    history = useQuery(api.security.history, {});
  const run = useMutation(api.security.run);
  const [jobId, setJobId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <p className="eyebrow">Controlled adversarial scenarios</p>
      <h1>Security lab</h1>
      <p className="muted mt-3">
        These probes evaluate backend rules and persist their rejection
        evidence. They never sign or submit a payment. Payment probes need an
        actual prepared intent; duplicate probes need a non-ready intent.
      </p>
      <section className="panel mt-8">
        <label className="field">
          Your job
          <select
            className="control"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">Select a recorded job</option>
            {data?.jobs.map((j) => (
              <option key={j._id} value={j._id}>
                {j.title} · {j.state}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-5 flex flex-wrap gap-3">
          {probes.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              disabled={!jobId || busy}
              onClick={async () => {
                setBusy(true);
                setMessage("");
                try {
                  const r = await run({
                    jobId: jobId as Id<"jobs">,
                    scenario: p.id,
                  });
                  setMessage(
                    r.available
                      ? `Rejected: ${r.reason}. Signing attempted: no.`
                      : `Unavailable: ${r.code}. Complete the required payment state first.`,
                  );
                } catch (e) {
                  setMessage(
                    e instanceof ConvexError
                      ? String(e.data)
                      : "Probe unavailable.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {message && (
          <p role="status" className="mt-4 text-amber-800">
            {message}
          </p>
        )}
      </section>
      <section className="panel mt-6">
        <h2>Your security audit</h2>
        {history === undefined ? (
          <p role="status">Loading audit…</p>
        ) : history.length === 0 ? (
          <p className="muted mt-3">No security attempts recorded.</p>
        ) : (
          <ol className="mt-4 grid gap-4">
            {history.map((e) => (
              <li
                key={e._id}
                className="border-l border-[#d5dccf] pl-4 text-sm"
              >
                <p>
                  {e.scenario} · {e.decision}
                </p>
                <p className="muted">{e.reason}</p>
                <time className="muted text-xs">
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        )}
        <p className="muted mt-4 text-xs">
          Latest 100 entries. Controlled probes are labeled separately from
          actual payment authorization and chain results.
        </p>
      </section>
    </>
  );
}

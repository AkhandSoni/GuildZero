"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "./ui/button";
export function RetentionPanel({ missionId }: { missionId: Id<"missions"> }) {
  const status = useQuery(api.retention.status, { missionId });
  const remove = useMutation(api.retention.removeContent);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className="panel mt-8" aria-labelledby="retention-heading">
    <h2 id="retention-heading">Dataset retention</h2>
    <p className="muted mt-3 text-sm">Demo policy: saved content stays until you explicitly remove it. There is no automatic expiry. Use synthetic data; do not upload sensitive personal data.</p>
    <p className="muted mt-3 text-sm">Removal clears this mission’s title, notes, source, parent/child inputs, outputs, column labels and free-text evidence from the active application database. It prevents reuse and further payments. IDs, amounts, decisions and transaction references remain for financial/security history. Public NEAR records cannot be deleted.</p>
    <p className="muted mt-3 text-sm">Downloaded files, copies in other missions, open tabs and operator backups are separate copies. This control cannot erase them; close other tabs and remove your exports separately. Operators must restrict and expire backups before real customer use. This demo makes no legal compliance claim.</p>
    {status === undefined ? <p role="status">Checking removal eligibility…</p> : status.removedAt !== null ? <p className="mt-3" role="status">Content removed on {new Date(status.removedAt).toLocaleString()}.</p> : <>
      {!status.eligible && <p className="muted mt-3" role="status">{status.reason}</p>}
      <Button className="mt-4" variant="destructive" disabled={!status.eligible || busy} onClick={() => setConfirming(true)}>Remove dataset and outputs</Button>
      {confirming && <div className="mt-4" role="group" aria-label="Confirm content removal"><p>This permanently removes the content of this mission and its cleaning subcontract from the active database. Export what you need first. Financial records stay. Continue?</p><div className="mt-3 flex flex-wrap gap-3"><Button variant="destructive" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await remove({ missionId, confirm: "REMOVE_DATASET_AND_OUTPUTS" }); setConfirming(false); }
        catch { setError("Content was not removed. Work or payment state may have changed; review eligibility and try again."); }
        finally { setBusy(false); }
      }}>{busy ? "Removing…" : "Confirm permanent removal"}</Button><Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Keep content</Button></div></div>}
    </>}
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
  </section>;
}

"use client";
import { use } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MissionForm } from "@/components/mission-form";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { RetentionPanel } from "@/components/retention-panel";
import { JobWorkspace } from "@/components/job-workspace";
export default function MissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const mission = useQuery(api.missions.get, { id: id as Id<"missions"> });
  const update = useMutation(api.missions.update);
  const remove = useMutation(api.missions.remove);
  const duplicate = useMutation(api.missions.duplicate);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!mission)
    return (
      <p role="status" className="muted">
        Loading mission…
      </p>
    );
  return (
    <div className="detail-layout">
      <header className="detail-heading"><p className="eyebrow">Private mission · {mission.state}</p>
      <h1>{mission.title}</h1>
      <p className="muted mb-8 mt-3">
        {mission.state === "draft"
          ? "Draft saved. No auction, agent execution, or payment has started."
          : "Mission brief locked. Activity below comes from stored records; payment status is shown separately in the receipt."}
      </p></header>
      <nav className="detail-tabs" aria-label="Mission sections"><a href="#mission-brief">Brief &amp; input</a>{mission.state === "active" && <><a href="#mission-progress">Work &amp; results</a><a href="#mission-settlement">Settlement</a></>}</nav>
      {editing ? (
        <MissionForm
          initial={mission}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await update({ id: mission._id, ...input });
            return () => setEditing(false);
          }}
        />
      ) : (
        <section id="mission-brief" className="panel grid gap-6">
          <dl className="brief-metadata">
            <div>
              <dt className="muted text-xs">Service</dt>
              <dd className="mt-1">{mission.serviceType}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Budget limit</dt>
              <dd className="mt-1">
                {formatNear(mission.maxBudgetYocto)} testnet NEAR
              </dd>
            </div>
            <div>
              <dt className="muted text-xs">Deadline</dt>
              <dd className="mt-1">
                {new Date(mission.deadlineAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="muted text-xs">Last updated</dt>
              <dd className="mt-1">
                {new Date(mission.updatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
          <div className="detail-brief-grid"><div>
            <h2>Saved processing options</h2>
            <p className="muted mt-3" data-testid="saved-options">
              {mission.options ? `${mission.options.columns.join(", ")}${mission.options.caseMode ? ` · ${mission.options.caseMode}` : ""}` : "Not set. Edit the draft before opening an auction."}
            </p>
            <p className="muted mt-2 text-xs">Cleaning subcontract: {mission.cleanBeforeProcessing ? "enabled, within the award" : "off"}. Acceptance: {mission.requiresHumanReview === false ? "automatic template checks" : "template checks plus human review"}.</p>
          </div>
          <div>
            <h2>Acceptance criteria</h2>
            <p className="muted mt-3 whitespace-pre-wrap">
              {mission.acceptanceCriteria}
            </p>
          </div>
          <details className="brief-source"><summary>Input CSV · view saved source</summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-[#eef1e9] p-4 text-xs leading-relaxed">
              {mission.contentRemovedAt !== undefined ? "Input removed by owner." : mission.inputCsv}
            </pre>
          </details></div>
        </section>
      )}
      {!editing && mission.contentRemovedAt === undefined && <div className="mt-5"><Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { const copy = await duplicate({ id: mission._id }); router.push(`/missions/${copy}`); }
        catch { setError("Could not reuse this brief. Check its input or try again."); }
        finally { setBusy(false); }
      }}>Use as new mission</Button><p className="muted mt-2 text-xs">Creates a private draft with the same input and options, a new deadline and no copied contracts or payments.</p></div>}
      {mission.state === "draft" && !editing && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit mission
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirming(!confirming)}
          >
            Delete draft
          </Button>
        </div>
      )}
      {!editing && <JobWorkspace key={`workspace:${mission._id}`} mission={mission} />}
      {mission.state === "active" && <RetentionPanel key={`retention:${mission._id}`} missionId={mission._id} />}
      {confirming && (
        <div className="panel mt-5">
          <p>Delete this draft and its input? This cannot be undone.</p>
          <div className="mt-4 flex gap-3">
            <Button
              disabled={busy}
              variant="destructive"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await remove({ id: mission._id });
                  router.replace("/dashboard");
                } catch {
                  setError("Unable to delete mission. Try again.");
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep mission
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

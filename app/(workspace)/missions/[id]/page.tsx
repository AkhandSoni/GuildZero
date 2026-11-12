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
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Private mission · {mission.state}</p>
      <h1>{mission.title}</h1>
      <p className="muted mb-8 mt-3">
        {mission.state === "draft"
          ? "Draft saved. No auction, agent execution, or payment has started."
          : "Mission brief locked. Activity below comes from stored records; payment status is shown separately in the receipt."}
      </p>
      {editing ? (
        <MissionForm
          initial={mission}
          onSave={async (input) => {
            await update({ id: mission._id, ...input });
            setEditing(false);
          }}
        />
      ) : (
        <section className="panel grid gap-6">
          <dl className="grid gap-5 sm:grid-cols-2">
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
          <div>
            <h2>Saved processing options</h2>
            <p className="muted mt-3" data-testid="saved-options">
              {mission.options ? `${mission.options.columns.join(", ")}${mission.options.caseMode ? ` · ${mission.options.caseMode}` : ""}` : "Not set. Edit the draft before opening an auction."}
            </p>
          </div>
          <div>
            <h2>Acceptance criteria</h2>
            <p className="muted mt-3 whitespace-pre-wrap">
              {mission.acceptanceCriteria}
            </p>
          </div>
          <div>
            <h2>Input CSV</h2>
            <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-neutral-950 p-4 text-xs leading-relaxed">
              {mission.inputCsv}
            </pre>
          </div>
        </section>
      )}
      {mission.state === "draft" && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setEditing(!editing)}>
            {editing ? "Cancel editing" : "Edit mission"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirming(!confirming)}
          >
            Delete draft
          </Button>
        </div>
      )}
      {!editing && <JobWorkspace mission={mission} />}
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
        <p role="alert" className="mt-4 text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

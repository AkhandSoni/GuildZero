"use client";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SAMPLE_CSV,
  validateMission,
  type MissionInput,
  type ServiceType,
} from "@/lib/missions";
import { formatNear, nearToYocto } from "@/lib/money";
function localDate(value: number) {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function MissionForm({
  initial,
  onSave,
}: {
  initial?: MissionInput;
  onSave: (input: MissionInput) => Promise<unknown>;
}) {
  const [csv, setCsv] = useState(initial?.inputCsv ?? "");
  const [deadline] = useState(() =>
    localDate(initial?.deadlineAt ?? Date.now() + 86400000),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="panel grid gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setBusy(true);
        const data = new FormData(event.currentTarget);
        try {
          const input = validateMission({
            title: String(data.get("title")),
            serviceType: String(data.get("serviceType")) as ServiceType,
            inputCsv: csv,
            maxBudgetYocto: nearToYocto(String(data.get("budget"))),
            acceptanceCriteria: String(data.get("acceptanceCriteria")),
            deadlineAt: new Date(String(data.get("deadline"))).getTime(),
          });
          await onSave(input);
        } catch (err) {
          setError(
            err instanceof ConvexError
              ? String(err.data)
              : err instanceof Error
                ? err.message
                : "Unable to save mission.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        Mission title
        <Input
          name="title"
          maxLength={100}
          required
          defaultValue={initial?.title}
          placeholder="Summarize weekly sales"
        />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field">
          Service template
          <select
            className="control"
            name="serviceType"
            defaultValue={initial?.serviceType ?? "csv_summary"}
          >
            <option value="csv_summary">CSV summary statistics</option>
            <option value="csv_normalize">CSV column normalization</option>
          </select>
        </label>
        <label className="field">
          Maximum budget (testnet NEAR)
          <Input
            name="budget"
            type="text"
            inputMode="decimal"
            required
            defaultValue={initial ? formatNear(initial.maxBudgetYocto) : "10"}
          />
          <span className="muted text-xs">
            Planning limit only. No deposit or payment.
          </span>
        </label>
      </div>
      <label className="field">
        Deadline (your local time)
        <Input
          name="deadline"
          type="datetime-local"
          required
          defaultValue={deadline}
        />
        <span className="muted text-xs">Within the next 30 days.</span>
      </label>
      <label className="field">
        CSV dataset
        <textarea
          className="control min-h-48 font-mono"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          required
          maxLength={65536}
          placeholder="product,units,price"
        />
        <span className="muted text-xs">
          Header required. Maximum 64 KiB, 500 data rows, 32 columns. Do not
          upload sensitive personal data.
        </span>
      </label>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => setCsv(SAMPLE_CSV)}
      >
        Use synthetic sample CSV
      </Button>
      <label className="field">
        Acceptance criteria
        <textarea
          className="control min-h-24"
          name="acceptanceCriteria"
          maxLength={1000}
          required
          defaultValue={
            initial?.acceptanceCriteria ??
            "Preserve row count. Report missing numeric values explicitly. Produce output matching the selected template."
          }
        />
        <span className="muted text-xs">
          Notes for the mission; automatic execution and verification arrive in
          Cluster 2.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={busy}>
        {busy ? "Saving…" : initial ? "Save changes" : "Create private mission"}
      </Button>
    </form>
  );
}

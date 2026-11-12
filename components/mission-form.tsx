"use client";
import { useState } from "react";
import Papa from "papaparse";
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
  const [serviceType, setServiceType] = useState<ServiceType>(initial?.serviceType ?? "csv_summary");
  const [selectedColumns, setSelectedColumns] = useState(initial?.options?.columns ?? []);
  function changeCsv(next: string) {
    const nextHeaders = Papa.parse<string[]>(next.slice(0, 65536), {
      delimiter: ",", skipEmptyLines: "greedy", preview: 1,
    }).data[0] ?? [];
    setCsv(next);
    setSelectedColumns((previous) => previous.filter((column) => nextHeaders.includes(column)));
  }
  const headers = Papa.parse<string[]>(csv.slice(0, 65536), {
    delimiter: ",", skipEmptyLines: "greedy", preview: 1,
  }).data[0] ?? [];
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
            options: serviceType === "csv_normalize"
              ? { columns: selectedColumns, caseMode: data.get("caseMode") === "lowercase" ? "lowercase" : "preserve" }
              : { columns: selectedColumns },
            inputCsv: csv,
            maxBudgetYocto: nearToYocto(String(data.get("budget"))),
            acceptanceCriteria: String(data.get("acceptanceCriteria")),
            deadlineAt: new Date(String(data.get("deadline"))).getTime(),
            requiresHumanReview: data.get("requiresHumanReview") === "on",
            cleanBeforeProcessing: serviceType === "csv_summary" && data.get("cleanBeforeProcessing") === "on",
          });
          await onSave(input);
        } catch (err) {
          setError(
            err instanceof ConvexError
              ? typeof err.data === "object" && err.data !== null && "message" in err.data ? String(err.data.message) : String(err.data)
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
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value as ServiceType)}
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
          onChange={(event) => changeCsv(event.target.value)}
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
        onClick={() => changeCsv(SAMPLE_CSV)}
      >
        Use synthetic sample CSV
      </Button>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm">Columns to process</legend>
        <p className="muted mb-2 text-xs">
          {serviceType === "csv_summary" ? "Select numeric columns for summary statistics." : "Selected columns are trimmed; choose how to handle letter case."}
          {" "}These options are saved with the mission. Column names match the CSV header exactly.
        </p>
        {headers.length > 0 && headers.length <= 32 ? headers.map((header, i) => (
          <label key={`${i}:${header}`} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="column" value={header}
              checked={selectedColumns.includes(header)}
              onChange={(e) => setSelectedColumns(e.target.checked
                ? [...selectedColumns, header]
                : selectedColumns.filter((column) => column !== header))} />
            {header}
          </label>
        )) : <p className="muted text-sm">Enter a CSV dataset to choose its columns.</p>}
      </fieldset>
      {serviceType === "csv_normalize" && <label className="field">
        Case handling
        <select name="caseMode" className="control"
          defaultValue={initial?.options && "caseMode" in initial.options ? initial.options.caseMode : "preserve"}>
          <option value="preserve">Preserve case</option>
          <option value="lowercase">Lowercase</option>
        </select>
      </label>}
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
          Human review notes. Processing uses the saved template options; these notes cannot change execution or payment rules.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="grid gap-4 rounded-2xl bg-white/50 p-4 text-sm">
        {serviceType === "csv_summary" && <label className="flex items-start gap-3"><input type="checkbox" name="cleanBeforeProcessing" defaultChecked={initial?.cleanBeforeProcessing ?? false} className="mt-1 shrink-0" /><span>Clean before analysis<span className="muted block text-xs mt-1">Hire one cleaning subcontractor within the awarded budget. Its verified CSV becomes the summary input.</span></span></label>}
        <label className="flex items-start gap-3"><input type="checkbox" name="requiresHumanReview" defaultChecked={initial ? initial.requiresHumanReview ?? true : false} className="mt-1 shrink-0" /><span>Require human review of acceptance notes<span className="muted block text-xs mt-1">Automatic verification covers the selected template and columns. Extra subjective requirements need your recorded decision before payment.</span></span></label>
      </div>
      <Button type="submit" className="w-fit" disabled={busy}>
        {busy ? "Saving…" : initial ? "Save changes" : "Create private mission"}
      </Button>
    </form>
  );
}

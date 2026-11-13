"use client";
import { useMemo, useRef, useState } from "react";
import { DatasetPreview } from "@/components/dataset-preview";
import { inspectDataset, readCsvFile } from "@/lib/dataset-preview";
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
  defaultService = "csv_summary",
  onSave,
}: {
  initial?: MissionInput;
  defaultService?: ServiceType;
  onSave: (input: MissionInput) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [budget, setBudget] = useState(initial ? formatNear(initial.maxBudgetYocto) : "10");
  const [criteria, setCriteria] = useState(initial?.acceptanceCriteria ?? "Preserve row count. Report missing numeric values explicitly. Produce output matching the selected template.");
  const [caseMode, setCaseMode] = useState<"preserve" | "lowercase">(initial?.options && "caseMode" in initial.options ? initial.options.caseMode : "preserve");
  const [cleanFirst, setCleanFirst] = useState(initial?.cleanBeforeProcessing ?? false);
  const [humanReview, setHumanReview] = useState(initial ? initial.requiresHumanReview ?? true : false);
  const [csv, setCsv] = useState(initial?.inputCsv ?? "");
  const [serviceType, setServiceType] = useState<ServiceType>(initial?.serviceType ?? defaultService);
  const [selectedColumns, setSelectedColumns] = useState(initial?.options?.columns ?? []);
  const [readingFile, setReadingFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const [importError, setImportError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dataset = useMemo(() => inspectDataset(csv), [csv]);
  function changeCsv(next: string) {
    setFileName("");
    setImportError("");
    const nextHeaders = Papa.parse<string[]>(next.slice(0, 65536), {
      delimiter: ",", skipEmptyLines: "greedy", preview: 1,
    }).data[0] ?? [];
    setCsv(next);
    setSelectedColumns((previous) => previous.filter((column) => nextHeaders.includes(column)));
  }
  const headers = Papa.parse<string[]>(csv.slice(0, 65536), {
    delimiter: ",", skipEmptyLines: "greedy", preview: 1,
  }).data[0] ?? [];
  const [deadline, setDeadline] = useState(() =>
    localDate(initial?.deadlineAt ?? Date.now() + 86400000),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="mission-form min-w-0 grid gap-5"
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        if (readingFile) return;
        setError("");
        setBusy(true);
        try {
          const input = validateMission({
            title,
            serviceType,
            options: serviceType === "csv_normalize"
              ? { columns: selectedColumns, caseMode }
              : { columns: selectedColumns },
            inputCsv: csv,
            maxBudgetYocto: nearToYocto(budget),
            acceptanceCriteria: criteria,
            deadlineAt: new Date(deadline).getTime(),
            requiresHumanReview: humanReview,
            cleanBeforeProcessing: serviceType === "csv_summary" && cleanFirst,
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
          requestAnimationFrame(() => errorRef.current?.focus());
        } finally {
          setBusy(false);
        }
      }}
    >
      <section className="form-section"><div className="form-section-heading"><span>01</span><div><h2>Define the mission</h2><p>Choose the work, its budget cap and deadline.</p></div></div>
      <label className="field">
        Mission title
        <Input
          name="title"
          type="text"
          maxLength={100}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Summarize weekly sales"
        />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field">
          Service template
          <select
            className="control"
            aria-label="Service template"
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
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
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
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
        <span className="muted text-xs">Within the next 30 days.</span>
      </label>
      </section>
      <section className="form-section"><div className="form-section-heading"><span>02</span><div><h2>Bring your dataset</h2><p>Upload a file or paste CSV. Review the preview before selecting columns.</p></div></div>
      <div className="grid gap-3 min-w-0">
        <label className="field" htmlFor="csv-file">Upload a CSV file</label>
        <Input id="csv-file" type="file" accept=".csv,text/csv" disabled={busy || readingFile}
          aria-describedby={importError ? "csv-file-help csv-file-error" : "csv-file-help"}
          aria-invalid={!!importError || undefined}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setReadingFile(true); setImportError("");
            try { const content = await readCsvFile(file); changeCsv(content); setFileName(file.name); }
            catch (err) { setImportError(err instanceof Error ? err.message : "Could not read this file. Choose it again or paste the CSV below."); }
            finally { setReadingFile(false); }
          }} />
        <p id="csv-file-help" className="muted text-xs">One UTF-8 .csv file, up to 64 KiB. Or paste your data below. Your file is read locally; data is stored only when you save the private mission.</p>
        {readingFile && <p role="status" className="muted text-sm">Reading CSV…</p>}
        {fileName && <p role="status" className="text-sm break-all">Loaded {fileName} into the editor. Save the mission to keep it.</p>}
        {importError && <p id="csv-file-error" role="alert" className="text-sm text-red-800">{importError} Your existing dataset has been kept.</p>}
      </div>
      <label className="field">
        CSV dataset
        <textarea
          id="mission-dataset"
          aria-label="CSV dataset"
          aria-describedby="csv-dataset-help"
          className="control min-h-48 font-mono"
          disabled={busy || readingFile}
          value={csv}
          onChange={(event) => changeCsv(event.target.value)}
          required
          maxLength={65536}
          placeholder="product,units,price"
        />
        <span id="csv-dataset-help" className="muted text-xs">
          Header required. Maximum 64 KiB, 500 data rows, 32 columns. Do not
          upload sensitive personal data.
        </span>
      </label>
      <div className="flex flex-wrap gap-3"><Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={readingFile || busy}
        onClick={() => changeCsv(SAMPLE_CSV)}
      >
        Use synthetic sample CSV
      </Button>
      {csv && <Button type="button" variant="outline" disabled={busy || readingFile} onClick={() => changeCsv("")}>Clear dataset</Button>}</div>
      <DatasetPreview csv={csv} data={dataset} />
      </section>
      <section className="form-section"><div className="form-section-heading"><span>03</span><div><h2>Configure processing</h2><p>Only your selected template and columns control the transformation.</p></div></div>
      <p className="service-description text-sm">{serviceType === "csv_summary" ? "Summary statistics keeps every data row and calculates count, missing values, minimum, maximum, sum and mean for your chosen numeric columns. Download the result as JSON or CSV." : "Column normalization trims surrounding spaces in selected columns and optionally lowercases them. Other cells and the row count are preserved. Download the result as CSV."}</p>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm">Columns to process</legend>
        <p className="muted mb-2 text-xs">
          {serviceType === "csv_summary" ? "Select numeric columns for summary statistics." : "Selected columns are trimmed; choose how to handle letter case."}
          {" "}These options are saved with the mission. Column names match the CSV header exactly.
        </p>
        <div className="flex flex-wrap gap-3 mb-2">
          {serviceType === "csv_summary" && dataset.ok && dataset.value.numericColumns.length > 0 && <Button type="button" variant="outline" onClick={() => setSelectedColumns([...dataset.value.numericColumns])}>Select numeric columns</Button>}
          {selectedColumns.length > 0 && <Button type="button" variant="outline" onClick={() => setSelectedColumns([])}>Clear column selection</Button>}
        </div>
        {serviceType === "csv_summary" && dataset.ok && dataset.value.columns.some((c) => selectedColumns.includes(c.name) && c.invalid > 0) && <p role="status" className="text-sm text-amber-900">Non-numeric values in: {dataset.value.columns.filter(c => selectedColumns.includes(c.name) && c.invalid > 0).map(c => `${c.name} (CSV record ${c.invalidRows.join(", ")})`).join("; ")}. Use Select numeric columns to correct the selection. Cleaning trims text; it does not turn product or region names into numbers.</p>}
        <div className="column-choices">{headers.length > 0 && headers.length <= 32 ? headers.map((header, i) => (
          <label key={`${i}:${header}`} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="column" value={header}
              checked={selectedColumns.includes(header)}
              onChange={(e) => setSelectedColumns(e.target.checked
                ? [...selectedColumns, header]
                : selectedColumns.filter((column) => column !== header))} />
            {header}
          </label>
        )) : <p className="muted text-sm">Enter a CSV dataset to choose its columns.</p>}</div>
      </fieldset>
      {serviceType === "csv_normalize" && <label className="field">
        Case handling
        <select name="caseMode" className="control"
          value={caseMode} onChange={(event) => setCaseMode(event.target.value as typeof caseMode)}>
          <option value="preserve">Preserve case</option>
          <option value="lowercase">Lowercase</option>
        </select>
      </label>}
      </section>
      <section className="form-section"><div className="form-section-heading"><span>04</span><div><h2>Set the acceptance rules</h2><p>Choose automatic template checks or a final human review.</p></div></div>
      <label className="field">
        Acceptance criteria
        <textarea
          className="control min-h-24"
          name="acceptanceCriteria"
          maxLength={1000}
          required
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        <span className="muted text-xs">
          Human review notes. Processing uses the saved template options; these notes cannot change execution or payment rules.
        </span>
      </label>
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="review-options grid gap-5 text-sm">
        {serviceType === "csv_summary" && <label className="flex items-start gap-3"><input type="checkbox" name="cleanBeforeProcessing" checked={cleanFirst} onChange={(event) => setCleanFirst(event.target.checked)} className="mt-1 shrink-0" /><span>Clean before analysis<span className="muted block text-xs mt-1">Hire one cleaning subcontractor within the awarded budget. Its verified CSV becomes the summary input.</span></span></label>}
        <label className="flex items-start gap-3"><input type="checkbox" name="requiresHumanReview" checked={humanReview} onChange={(event) => setHumanReview(event.target.checked)} className="mt-1 shrink-0" /><span>Require human review of acceptance notes<span className="muted block text-xs mt-1">Automatic verification covers the selected template and columns. Extra subjective requirements need your recorded decision before payment.</span></span></label>
      </div>
      </section>
      <div className="form-submit"><p>Saving creates a private brief. It does not open an auction or send funds.</p><Button type="submit" className="w-fit" disabled={busy || readingFile}>
        {busy ? "Saving…" : initial ? "Save changes" : "Create private mission"}
      </Button></div>
    </form>
  );
}

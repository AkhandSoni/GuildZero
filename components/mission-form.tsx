"use client";
import { useMemo, useRef, useState } from "react";
import { useUnsavedMission } from "@/components/use-unsaved-mission";
import { DatasetPreview } from "@/components/dataset-preview";
import { inspectDataset, readCsvFile } from "@/lib/dataset-preview";
import { inspectSummaryInput, summaryIssueMessage, STRICT_SUMMARY_INPUT } from "@/lib/summary-preflight";
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
import { SERVICE_LABELS, SERVICE_TYPES } from "@/lib/services";
import { BusinessControls, type BusinessDraft } from "./business-controls";
import type { ServiceOptions } from "@/lib/economy/types";
import { RECONCILIATION_SAMPLE } from "@/lib/business-samples";
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
  onCancel,
}: {
  initial?: MissionInput;
  defaultService?: ServiceType;
  onSave: (input: MissionInput) => Promise<void | (() => void)>;
  onCancel?: () => void;
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
  const [business, setBusiness] = useState<BusinessDraft>(() => ({
    numericColumns: initial?.options && "numericColumns" in initial.options ? initial.options.numericColumns : [],
    keyColumn: initial?.options && "keyColumn" in initial.options ? initial.options.keyColumn : "",
    groupBy: initial?.options && "groupBy" in initial.options ? initial.options.groupBy : "",
    comparisonCsv: initial?.options && "comparisonCsv" in initial.options ? initial.options.comparisonCsv : "",
  }));
  const processingOptions: ServiceOptions = serviceType === "csv_normalize" ? { columns: selectedColumns, caseMode }
    : serviceType === "csv_validate" ? { columns: selectedColumns, numericColumns: business.numericColumns.filter(c => selectedColumns.includes(c)) }
    : serviceType === "csv_report" ? { columns: selectedColumns, groupBy: business.groupBy }
    : serviceType === "csv_reconcile" ? { columns: selectedColumns, keyColumn: business.keyColumn, comparisonCsv: business.comparisonCsv }
    : { columns: selectedColumns };
  const [readingFile, setReadingFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const [importError, setImportError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dataset = useMemo(() => inspectDataset(csv), [csv]);
  const summaryInput = useMemo(() => inspectSummaryInput(csv, selectedColumns), [csv, selectedColumns]);
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
  const snapshot = JSON.stringify({ title, budget, criteria, caseMode, cleanFirst, humanReview, csv, serviceType, selectedColumns, deadline, business });
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = snapshot !== baseline;
  const guard = useUnsavedMission(dirty);
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
            options: processingOptions,
            inputCsv: csv,
            maxBudgetYocto: nearToYocto(budget),
            acceptanceCriteria: criteria,
            deadlineAt: new Date(deadline).getTime(),
            requiresHumanReview: humanReview,
            cleanBeforeProcessing: serviceType === "csv_summary" && cleanFirst,
          });
          const afterSave = await onSave(input);
          await guard.saved();
          setBaseline(snapshot);
          afterSave?.();
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
      <fieldset disabled={busy || readingFile} className="grid min-w-0 gap-5" aria-busy={busy || readingFile}>
      <p role="status" className="muted text-sm">{dirty ? "Unsaved changes. Save this private brief to keep your edits." : "No unsaved changes."} Nothing is autosaved in this browser.</p>
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
      <div className="form-field-pair">
        <label className="field">
          <span>Service template</span>
          <select
            className="control"
            aria-label="Service template"
            name="serviceType"
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value as ServiceType)}
          >
            <option value="csv_summary">CSV summary statistics</option>
            <option value="csv_normalize">CSV column normalization</option>
            {SERVICE_TYPES.filter(s => s !== "csv_summary" && s !== "csv_normalize").map(s => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Maximum budget (testnet NEAR)</span>
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
        onClick={() => changeCsv(serviceType === "csv_reconcile" ? RECONCILIATION_SAMPLE : SAMPLE_CSV)}
      >
        Use synthetic sample CSV
      </Button>
      {csv && <Button type="button" variant="outline" disabled={busy || readingFile} onClick={() => changeCsv("")}>Clear dataset</Button>}</div>
      <DatasetPreview csv={csv} data={dataset} />
      </section>
      <section className="form-section"><div className="form-section-heading"><span>03</span><div><h2>Configure processing</h2><p>Only your selected template and columns control the transformation.</p></div></div>
      <p className="service-description text-sm">{serviceType === "csv_summary" ? "Summary statistics keeps every data row and calculates count, missing values, minimum, maximum, sum and mean for your chosen numeric columns. Full result downloads unlock as JSON or CSV after confirmed settlement." : serviceType === "csv_normalize" ? "Column normalization trims surrounding spaces in selected columns and optionally lowercases them. Other cells and the row count are preserved. The full CSV download unlocks after confirmed settlement." : serviceType === "csv_validate" ? "Audit missing cells, repeated values and whitespace, with optional numeric checks. Findings are the report's useful result; they do not mean the service failed verification." : serviceType === "csv_reconcile" ? "Compare two files by an explicit unique key. Report unchanged, changed and unmatched records without guessing conversions. Counts are complete; examples show up to 25 differing keys, three changed fields per key and 80 characters per value." : "Compute a separate numeric summary for each exact group label. This produces real counts, missing values, totals and descriptive statistics, without changing the source."}</p>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm">Columns to process</legend>
        <p className="muted mb-2 text-xs">
          {serviceType === "csv_summary" || serviceType === "csv_report" ? "Select numeric measures. The grouping column is configured separately." : serviceType === "csv_normalize" ? "Selected columns are trimmed; choose how to handle letter case." : serviceType === "csv_reconcile" ? "Select the shared value columns to compare, excluding the key." : "Select columns to audit; configure optional numeric checks below."}
          {" "}These options are saved with the mission. Column names match the CSV header exactly.
        </p>
        <div className="flex flex-wrap gap-3 mb-2">
          {(serviceType === "csv_summary" || serviceType === "csv_report") && dataset.ok && dataset.value.numericColumns.length > 0 && <Button type="button" variant="outline" onClick={() => setSelectedColumns(dataset.value.numericColumns.filter(c => serviceType !== "csv_report" || c !== business.groupBy))}>Select numeric columns</Button>}
          {selectedColumns.length > 0 && <Button type="button" variant="outline" onClick={() => setSelectedColumns([])}>Clear column selection</Button>}
        </div>
        {serviceType === "csv_summary" && <div className="grid gap-2 text-sm" aria-label="Summary input requirements">
          <p className="muted text-xs">{STRICT_SUMMARY_INPUT} Numeric values must be finite, within ±1e12 and must not underflow to zero. This is numerical analysis, not financial accounting.</p>
          {summaryInput.ok && summaryInput.value.length > 0 && <div role="status" className="text-amber-900"><p>Save this draft to keep editing; an auction cannot start until these selected columns are corrected or deselected:</p><ul>{summaryInput.value.map(issue => <li key={issue.column}>{summaryIssueMessage(issue)}</li>)}</ul></div>}
        </div>}
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
      <BusinessControls serviceType={serviceType} headers={headers} columns={selectedColumns} value={business} onChange={setBusiness} onReading={setReadingFile} onReservedColumn={column => setSelectedColumns(previous => previous.filter(c => c !== column))}/>
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
      <div className="form-submit"><p>Saving creates a private brief. It does not open an auction or send funds.</p><div className="form-submit-actions"><Button type="submit" className="w-fit" disabled={busy || readingFile}>
        {busy ? "Saving…" : initial ? "Save changes" : "Create private mission"}
      </Button>{onCancel && <Button type="button" variant="outline" disabled={busy || readingFile} onClick={async () => { if (await guard.discard()) onCancel(); }}>Cancel editing</Button>}</div></div>
      </fieldset>
    </form>
  );
}

"use client";
import { useState } from "react";
import type { ServiceType } from "@/lib/services";
import { inspectDataset, readCsvFile } from "@/lib/dataset-preview";
import { DatasetPreview } from "./dataset-preview";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { COMPARISON_SAMPLE } from "@/lib/business-samples";

export type BusinessDraft = { numericColumns: string[]; keyColumn: string; groupBy: string; comparisonCsv: string };
export function BusinessControls({ serviceType, headers, columns, value, onChange, onReading, onReservedColumn }: {
  serviceType: ServiceType; headers: string[]; columns: string[]; value: BusinessDraft;
  onChange: (value: BusinessDraft) => void; onReading: (busy: boolean) => void; onReservedColumn: (column: string) => void;
}) {
  const [error, setError] = useState("");
  if (serviceType === "csv_validate") return <fieldset className="grid gap-3"><legend className="mb-2">Optional numeric checks</legend>
    <p className="muted text-xs">Every selected column is checked for missing cells, duplicate nonblank values and surrounding whitespace. Explicit numeric checks flag unsupported numbers as findings. No data is changed.</p>
    {columns.map(column => <label key={column} className="flex gap-2 text-sm"><input type="checkbox" checked={value.numericColumns.includes(column)} onChange={e => onChange({ ...value, numericColumns: e.target.checked ? [...value.numericColumns, column] : value.numericColumns.filter(c => c !== column) })}/>Check {column} as numeric</label>)}
  </fieldset>;
  if (serviceType === "csv_report") return <label className="field">Group by column<select className="control" aria-label="Group by column" aria-describedby="group-help" value={value.groupBy} onChange={e => { onChange({ ...value, groupBy: e.target.value }); onReservedColumn(e.target.value); }}><option value="">Choose a grouping column</option>{headers.map(h => <option value={h} key={h}>{h}</option>)}</select><span id="group-help" className="muted text-xs">Grouping is exact and case-sensitive; blank labels form their own group. Select numeric measures separately. Up to 50 groups and 128 group/measure combinations. No currency or derived revenue is inferred.</span></label>;
  if (serviceType !== "csv_reconcile") return null;
  const other = inspectDataset(value.comparisonCsv);
  const shared = other.ok ? headers.filter(h => other.value.headers.includes(h)) : [];
  return <section className="grid min-w-0 gap-4" aria-label="Comparison dataset">
    <label className="field">Upload comparison CSV<Input type="file" accept=".csv,text/csv" onChange={async e => {
      const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
      if (!file) return;
      onReading(true); setError("");
      try { const comparisonCsv = await readCsvFile(file); onChange({ ...value, comparisonCsv }); }
      catch (error) { setError(error instanceof Error ? error.message : "Comparison file could not be read."); }
      finally { onReading(false); }
    }}/></label>
    <label className="field">Comparison CSV<textarea aria-label="Comparison CSV" aria-describedby="comparison-help" className="control min-h-32" maxLength={65536} value={value.comparisonCsv} onChange={e => { setError(""); onChange({ ...value, comparisonCsv: e.target.value }); }}/><span id="comparison-help" className="muted text-xs">Same 64 KiB / 500-row / 32-column limits. Uploads replace only this comparison dataset. Both inputs stay private and follow the same retention policy.</span></label>
    {error && <p role="alert">{error}</p>}
    <Button type="button" variant="outline" onClick={() => { setError(""); onChange({ ...value, comparisonCsv: COMPARISON_SAMPLE }); }}>Use synthetic comparison CSV</Button>
    {value.comparisonCsv && <Button type="button" variant="outline" onClick={() => onChange({ ...value, comparisonCsv: "", keyColumn: "" })}>Clear comparison dataset</Button>}
    <DatasetPreview csv={value.comparisonCsv} data={other}/>
    <label className="field">Match rows by key<select className="control" aria-label="Match rows by key" aria-describedby="key-help" value={value.keyColumn} onChange={e => { onChange({ ...value, keyColumn: e.target.value }); onReservedColumn(e.target.value); }}><option value="">Choose a shared key column</option>{shared.map(h => <option key={h} value={h}>{h}</option>)}</select><span id="key-help" className="muted text-xs">Keys must be nonblank, unique in each file and at most 100 characters. Matching and value comparison are exact and case-sensitive; spaces and number formatting are significant. Select shared comparison columns above, excluding the key. No fuzzy matching or automatic conversion.</span></label>
  </section>;
}

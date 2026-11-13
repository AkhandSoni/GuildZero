"use client";
import { readSummary, summaryCsv } from "@/lib/dataset-preview";
import { parseBoundedCsv } from "@/lib/economy/csv-input";
import { Button } from "@/components/ui/button";
import { readBusinessOutput } from "@/lib/business-output";
import { BusinessResult } from "./business-result";
export function ResultPreview({ content, format }: { content: string; format: "json" | "csv" }) {
  if (format === "csv") {
    const data = parseBoundedCsv(content);
    if (!data.ok) return null;
    return <div className="mt-4 max-w-full overflow-x-auto" role="region" aria-label="Normalized result preview" tabIndex={0}>
      <table className="w-full text-left text-xs"><caption className="text-left pb-2">Normalized data · {data.value.rawRows.length} rows · first five shown</caption><thead><tr>{data.value.rawHeader.map((h) => <th scope="col" className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{data.value.rawRows.slice(0,5).map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j} className="p-2 max-w-64 break-words whitespace-pre-wrap">{cell || "—"}</td>)}</tr>)}</tbody></table>
    </div>;
  }
  const business = readBusinessOutput(content);
  if (business) return <BusinessResult report={business}/>;
  const summary = readSummary(content);
  if (!summary) return null;
  const csv = summaryCsv(summary);
  return <div className="mt-4 min-w-0">
    <div className="max-w-full overflow-x-auto" role="region" aria-label="Summary result" tabIndex={0}>
      <table className="w-full text-left text-xs"><caption className="text-left pb-3 font-medium">Summary of {summary.rowCount} data rows</caption><thead><tr>{["Column","Count","Missing","Minimum","Maximum","Sum","Mean"].map((h) => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead><tbody>{summary.columns.map((c) => <tr key={c.name}><th scope="row" className="p-2 font-normal break-all">{c.name}</th>{[c.count,c.missing,c.min,c.max,c.sum,c.mean].map((n,i) => <td key={i} className="p-2 tabular-nums">{n === null ? "—" : String(n)}</td>)}</tr>)}</tbody></table>
    </div>
    <p className="muted mt-3 text-xs">Computed values from this stored attempt. The matching approved result was released after confirmed settlement. A dash means no numerical value is available. Sum is the sum of the selected column, including a price column; it is not derived sales revenue. Currency and financial precision are not inferred.</p>
    {csv !== null && <Button asChild variant="outline" className="mt-3"><a download="guildzero-summary.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Download summary CSV</a></Button>}
  </div>;
}

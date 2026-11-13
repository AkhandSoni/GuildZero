"use client";
import type { inspectDataset } from "@/lib/dataset-preview";
export function DatasetPreview({ csv, data }: { csv: string; data: ReturnType<typeof inspectDataset> }) {
  if (!csv) return null;
  if (!data.ok) return <p role="status" className="text-sm text-amber-900">Dataset needs attention: {data.message}</p>;
  return <section className="min-w-0 grid gap-3" aria-label="Dataset preview">
    <h2 className="!text-base">Dataset preview</h2>
    <p className="muted text-sm">{data.value.rowCount} data rows · {data.value.headers.length} columns · {data.value.bytes.toLocaleString()} bytes. Showing the first {data.value.previewRows.length} rows.</p>
    <div className="max-w-full overflow-x-auto rounded-xl border border-[#d5dccf]" tabIndex={0} role="region" aria-label="Preview rows">
      <table className="w-full text-left text-xs"><thead><tr>{data.value.headers.map((h) => <th key={h} scope="col" className="whitespace-pre-wrap p-3 border-b">{h}</th>)}</tr></thead><tbody>{data.value.previewRows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="max-w-64 min-w-20 whitespace-pre-wrap break-words p-3 border-b">{cell || <span className="muted italic">Empty</span>}</td>)}</tr>)}</tbody></table>
    </div>
    <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Column quality">
      <table className="w-full text-left text-xs"><caption className="text-left font-medium py-2">Column quality for summary statistics</caption><thead><tr>{["Column", "Numeric", "Empty", "Other / invalid", "Check source rows"].map((h) => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead><tbody>{data.value.columns.map((c) => <tr key={c.name}><th scope="row" className="p-2 font-normal break-all">{c.name}</th><td className="p-2">{c.numeric}</td><td className="p-2">{c.missing}</td><td className="p-2">{c.invalid}</td><td className="p-2">{c.invalidRows.length ? c.invalidRows.join(", ") : "—"}</td></tr>)}</tbody></table>
    </div>
    <p className="muted text-xs">Source row numbers include the header and count CSV records, including quoted multiline fields. Empty cells are counted as missing; text and invalid numbers cannot be summarized. Preview does not change your data.</p>
  </section>;
}

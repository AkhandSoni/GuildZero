"use client";
import type { BusinessOutput } from "@/lib/economy/types";
import { SERVICE_LABELS } from "@/lib/services";

const countLabels: Record<string, string> = { unchanged: "Unchanged", changed: "Changed", leftOnly: "Primary only", rightOnly: "Comparison only" };
export function BusinessResult({ report }: { report: BusinessOutput }) {
  return <div className="mt-4 min-w-0" role="region" aria-label="Business report result">
    <h3>{SERVICE_LABELS[report.serviceType]} · {report.rowCount} primary data rows</h3>
    {report.serviceType === "csv_validate" ? <>
      <p className="muted mt-2 text-xs">Findings describe the source, not service failure. Duplicates count nonblank repeated occurrences after the first; equality is exact. Numeric checks run only where requested. Source data is unchanged.</p>
      <div className="overflow-x-auto mt-4" tabIndex={0}><table className="w-full text-xs text-left"><thead><tr>{["Column","Missing","Duplicate occurrences","Distinct nonblank","Whitespace","Invalid numeric"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{report.checks.map(c => <tr key={c.name}><th scope="row" className="p-2">{c.name}</th>{[c.missing,c.duplicates,c.distinct,c.whitespace,c.invalidNumeric].map((n,i) => <td key={i} className="p-2">{n ?? "Not requested"}</td>)}</tr>)}</tbody></table></div>
      <details className="audit-details"><summary>Finding examples · {report.examples.length}{report.examplesTruncated ? " (limited to first 100)" : ""}</summary><ul>{report.examples.map((e,i) => <li key={i}>CSV record {e.record} · {e.column} · {e.rule.replaceAll("_"," ")}</li>)}</ul></details>
    </> : report.serviceType === "csv_reconcile" ? <>
      <p className="muted text-xs mt-2">Comparison rows: {report.comparisonRowCount}. Key: {report.keyColumn}. Counts cover all records; examples are bounded and do not contain full rows. Values and keys are compared exactly, without numeric conversion.</p>
      <dl className="brief-metadata mt-4">{Object.entries(report.counts).map(([k,v]) => <div key={k}><dt>{countLabels[k]}</dt><dd>{v}</dd></div>)}</dl>
      <details className="audit-details"><summary>Difference examples · {report.examples.length}{report.examplesTruncated ? " (limited to first 25 differing keys)" : ""}</summary><ul>{report.examples.map(e => <li className="py-3 break-words" key={e.key}><strong>{e.key}</strong> · {e.status.replaceAll("_"," ")}{e.totalChangedColumns > 0 ? ` · ${e.totalChangedColumns} changed columns` : ""}<ul>{e.changes.map(c => <li key={c.column}>{c.column}: <span className="whitespace-pre-wrap">{c.left || "(blank)"}</span> → <span className="whitespace-pre-wrap">{c.right || "(blank)"}</span>{c.truncated ? " (value shortened to 80 characters)" : ""}</li>)}</ul>{e.totalChangedColumns > e.changes.length && <p>First three changed columns shown.</p>}</li>)}</ul></details>
    </> : <>
      <p className="muted mt-2 text-xs">Grouped by {report.groupBy} · {report.groups.length} groups. All groups are shown. Sum is the selected column total, not inferred revenue or currency accounting.</p>
      <div className="overflow-x-auto mt-4" tabIndex={0}><table className="w-full text-left text-xs"><thead><tr>{["Group","Rows","Measure","Count","Missing","Minimum","Maximum","Sum","Mean"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{report.groups.flatMap(g => g.statistics.map(s => <tr key={JSON.stringify([g.key,s.name])}><th scope="row" className="p-2 whitespace-pre-wrap">{g.key || "(blank group)"}</th><td className="p-2">{g.rowCount}</td><td className="p-2">{s.name}</td>{[s.count,s.missing,s.min,s.max,s.sum,s.mean].map((n,i) => <td className="p-2 tabular-nums" key={i}>{n === null ? "—" : String(n)}</td>)}</tr>))}</tbody></table></div>
    </>}
  </div>;
}

"use client";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { ResultPreview } from "@/components/result-preview";
import { isUnsafeFormulaValue } from "@/lib/economy/csv-input";
type Deliverable = {
  attempt: number;
  format: "json" | "csv";
  content: string | null;
  isLatest: boolean;
  preview: { rowCount: number | null; columnCount: number; columns: string[]; columnsTruncated: boolean; bytes: number };
};
type Delivery = { released: boolean; confirmedPayments: number; requiredPayments: number; reason: string };
function safeCsv(content: string) {
  const parsed = Papa.parse<string[]>(content, { delimiter: ",", skipEmptyLines: false });
  return !parsed.errors.length && parsed.data.every(row => row.every(cell => !isUnsafeFormulaValue(cell)));
}
export function DeliverablePanel({ deliverable: d, delivery, approved }: { deliverable: Deliverable; delivery: Delivery; approved: boolean }) {
  const content = delivery.released && d.isLatest ? d.content : null;
  return <section className="panel min-w-0">
    <h2>Deliverable · attempt {d.attempt + 1}</h2>
    {content !== null ? <>
      <p className="outcome-pill approved mt-3">Full result released · mission payments confirmed</p>
      <ResultPreview content={content} format={d.format}/>
      <details className="audit-details"><summary>View raw deliverable</summary><pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{content}</pre></details>
      {d.format === "json" && <Button asChild className="mt-3" variant="outline"><a download="guildzero-summary.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(content)}`}>Download JSON</a></Button>}
      {d.format === "csv" && (safeCsv(content)
        ? <Button asChild className="mt-3" variant="outline"><a download="guildzero-normalized.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(content)}`}>Download CSV</a></Button>
        : <p className="muted text-xs mt-3">CSV download blocked: unsafe spreadsheet values or invalid CSV.</p>)}
    </> : <div className="locked-deliverable" role="region" aria-label="Locked deliverable preview">
      <p className="outcome-pill">Full result locked</p>
      <h3>{d.isLatest ? "Output prepared · payment required for release" : "Earlier attempt · full content unavailable"}</h3>
      <dl>
        <div><dt>Format</dt><dd>{d.format.toUpperCase()}</dd></div>
        <div><dt>Data rows</dt><dd>{d.preview.rowCount ?? "Schema not available"}</dd></div>
        <div><dt>Output columns</dt><dd>{d.preview.columnCount || "Schema not available"}</dd></div>
        <div><dt>Output size</dt><dd>{d.preview.bytes.toLocaleString()} bytes</dd></div>
      </dl>
      {d.preview.columns.length > 0 && <p>Columns: {d.preview.columns.join(", ")}{d.preview.columnsTruncated ? " (first five shown)" : ""}.</p>}
      <p>Preview contains metadata only. Computed values, processed rows, raw output and downloads stay locked until every required payment has a matching confirmed testnet receipt.</p>
      <p>{d.isLatest
        ? `${delivery.confirmedPayments} of ${delivery.requiredPayments} required payments confirmed. Review verification below; use the payment receipt to settle the work.`
        : "This attempt was superseded. Only the latest approved deliverable can be released by its matching payment."}</p>
      {delivery.reason === "DELIVERY_STRUCTURE_INVALID" && <p>Saved job relationships could not be validated. Operator review is required before release.</p>}
      {delivery.reason === "PAYMENT_EVIDENCE_NOT_DISTINCT" && <p>Each allocation needs its own distinct confirmed transaction. Operator review is required before release.</p>}
      {delivery.requiredPayments > 1 && <p>Both the main agent and cleaning allocation must settle. Expand the cleaning subcontract below to review its separate receipt; both amounts come from the original award.</p>}
      {!approved && <p>Work must be approved before payment can be prepared.</p>}
    </div>}
  </section>;
}

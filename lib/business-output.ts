import type { BusinessOutput } from "./economy/types";
import { MAX_OUTPUT_BYTES } from "./economy/csv-input";
import { readSummary } from "./dataset-preview";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, max = 500): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v: unknown, max = 100): v is string => typeof v === "string" && v.length <= max;
export function readBusinessOutput(content: string): BusinessOutput | null {
  if (new TextEncoder().encode(content).length > MAX_OUTPUT_BYTES) return null;
  try {
    const v: unknown = JSON.parse(content);
    if (!record(v) || v.format !== "json" || !integer(v.rowCount) || v.rowCount < 1 || !Array.isArray(v.columns) || !v.columns.length || v.columns.length > 32 || !v.columns.every(c => text(c))) return null;
    if (v.serviceType === "csv_validate") {
      if (!Array.isArray(v.checks) || v.checks.length !== v.columns.length || !v.checks.every(c => record(c) && text(c.name) && [c.missing,c.duplicates,c.distinct,c.whitespace].every(n => integer(n)) && (c.invalidNumeric === null || integer(c.invalidNumeric)))) return null;
      if (!Array.isArray(v.examples) || v.examples.length > 100 || !v.examples.every(e => record(e) && integer(e.record,501) && text(e.column) && ["missing","duplicate","whitespace","non_numeric"].includes(String(e.rule))) || typeof v.examplesTruncated !== "boolean") return null;
    } else if (v.serviceType === "csv_report") {
      if (!text(v.groupBy) || !Array.isArray(v.groups) || !v.groups.length || v.groups.length > 50 || !v.groups.every(g => record(g) && text(g.key) && integer(g.rowCount) && g.rowCount > 0 && readSummary(JSON.stringify({serviceType:"csv_summary",format:"json",rowCount:g.rowCount,columns:g.statistics})))) return null;
    } else if (v.serviceType === "csv_reconcile") {
      if (!text(v.keyColumn) || !integer(v.comparisonRowCount) || !record(v.counts) || ![v.counts.unchanged,v.counts.changed,v.counts.leftOnly,v.counts.rightOnly].every(n => integer(n)) || typeof v.examplesTruncated !== "boolean") return null;
      if (!Array.isArray(v.examples) || v.examples.length > 25 || !v.examples.every(e => record(e) && text(e.key) && ["changed","left_only","right_only"].includes(String(e.status)) && integer(e.totalChangedColumns,32) && Array.isArray(e.changes) && e.changes.length <= 3 && e.changes.every(c => record(c) && text(c.column) && text(c.left,80) && text(c.right,80) && typeof c.truncated === "boolean"))) return null;
    } else return null;
    return v as BusinessOutput;
  } catch { return null; }
}

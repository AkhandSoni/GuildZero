import { isSafeNumericLiteral, isUnsafeFormulaValue, parseBoundedCsv } from "./economy/csv-input";
import type { Result } from "./economy/types";

export const STRICT_SUMMARY_INPUT = "Use plain decimal numbers with a dot (for example -1234.50) or scientific notation. Currency symbols, thousands separators, decimal commas and percentages are not converted. Correct them explicitly in your source export, or deselect those columns. Empty cells count as missing. Cleaning only trims text.";
export type SummaryInputIssue = {
  column: string;
  invalidCount: number;
  records: number[];
  code: "INVALID_NUMBER" | "UNSAFE_CSV_CELL";
};

/** Shared launch/editor check; reads original cells without rewriting or guessing units. */
export function inspectSummaryInput(csv: string, columns: readonly string[]): Result<SummaryInputIssue[]> {
  const parsed = parseBoundedCsv(csv);
  if (!parsed.ok) return parsed;
  const issues: SummaryInputIssue[] = [];
  for (const column of columns) {
    const index = parsed.value.rawHeader.indexOf(column);
    if (index < 0) return { ok: false, code: "INVALID_COLUMNS", message: "Selected columns must match the saved CSV headers." };
    const records: number[] = [];
    let invalidCount = 0;
    let code: SummaryInputIssue["code"] = "INVALID_NUMBER";
    for (const [i, row] of parsed.value.rawRows.entries()) {
      const raw = row[index];
      const value = raw.trim();
      if (!value || isSafeNumericLiteral(value)) continue;
      if (invalidCount === 0 && isUnsafeFormulaValue(raw)) code = "UNSAFE_CSV_CELL";
      invalidCount++;
      if (records.length < 3) records.push(i + 2);
    }
    if (invalidCount) issues.push({ column, records, invalidCount, code });
  }
  return { ok: true, value: issues };
}
export function summaryIssueMessage(issue: SummaryInputIssue) {
  return `Column "${issue.column}": unsupported numeric input in CSV record${issue.records.length === 1 ? "" : "s"} ${issue.records.join(", ")}${issue.invalidCount > issue.records.length ? ` (first ${issue.records.length} of ${issue.invalidCount})` : ""}.`;
}

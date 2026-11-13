import Papa from "papaparse";
import { isSafeNumericLiteral, isUnsafeFormulaValue, MAX_INPUT_CSV_BYTES, parseBoundedCsv } from "./economy/csv-input";
import type { ColumnStatistics } from "./economy/types";

export function inspectDataset(csv: string) {
  const parsed = parseBoundedCsv(csv);
  if (!parsed.ok) return parsed;
  const { rawHeader, rawRows } = parsed.value;
  const columns = rawHeader.map((name, index) => {
    let missing = 0, numeric = 0, unsafe = 0;
    const invalidRows: number[] = [];
    rawRows.forEach((row, i) => {
      const value = row[index].trim();
      if (!value) missing++;
      else if (isSafeNumericLiteral(value)) numeric++;
      else { invalidRows.push(i + 2); if (isUnsafeFormulaValue(row[index])) unsafe++; }
    });
    return { name, missing, numeric, unsafe, invalid: invalidRows.length, invalidRows: invalidRows.slice(0, 3) };
  });
  return { ok: true as const, value: {
    headers: rawHeader, previewRows: rawRows.slice(0, 5), rowCount: rawRows.length,
    bytes: new TextEncoder().encode(csv).length, columns,
    numericColumns: columns.filter((column) => column.numeric > 0 && column.invalid === 0).map((column) => column.name),
  } };
}

export async function readCsvFile(file: Pick<File, "name" | "size" | "arrayBuffer">) {
  if (!/\.csv$/i.test(file.name)) throw new Error("Choose a .csv file. Export spreadsheets as CSV (UTF-8) first.");
  if (file.size > MAX_INPUT_CSV_BYTES) throw new Error("Choose a CSV file no larger than 64 KiB.");
  if (file.size === 0) throw new Error("This file is empty. Choose a CSV with a header and at least one data row.");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_INPUT_CSV_BYTES) throw new Error("Choose a CSV file no larger than 64 KiB.");
  let csv: string;
  try { csv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("This file is not UTF-8 text. Export it as CSV (UTF-8) and try again."); }
  if (csv.includes("\0")) throw new Error("This file contains binary or UTF-16 data. Export it as CSV (UTF-8) first.");
  const checked = parseBoundedCsv(csv);
  if (!checked.ok) throw new Error(checked.message);
  return csv;
}

export function readSummary(content: string): { rowCount: number; columns: ColumnStatistics[] } | null {
  try {
    const value = JSON.parse(content);
    if (value?.serviceType !== "csv_summary" || value.format !== "json" || !Number.isInteger(value.rowCount) || value.rowCount < 1 || value.rowCount > 500 || !Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > 32) return null;
    if (!value.columns.every((c: ColumnStatistics) => c && typeof c.name === "string" && c.name.length <= 100 &&
      Number.isInteger(c.count) && c.count >= 0 && Number.isInteger(c.missing) && c.missing >= 0 && c.count + c.missing === value.rowCount &&
      typeof c.sum === "number" && Number.isFinite(c.sum) && [c.min, c.max, c.mean].every((n) => n === null || typeof n === "number" && Number.isFinite(n)))) return null;
    return { rowCount: value.rowCount, columns: value.columns };
  } catch { return null; }
}
export function summaryCsv(summary: NonNullable<ReturnType<typeof readSummary>>) {
  // Never offer a spreadsheet export with a formula-like column label.
  if (summary.columns.some((c) => isUnsafeFormulaValue(c.name))) return null;
  return Papa.unparse([
    ["column", "count", "missing", "minimum", "maximum", "sum", "mean"],
    ...summary.columns.map((c) => [c.name, c.count, c.missing, c.min ?? "", c.max ?? "", c.sum, c.mean ?? ""]),
  ]);
}

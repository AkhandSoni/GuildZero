// CSV service implementation for deterministic economy kernel
import Papa from "papaparse";
import type { ServiceRequest, ServiceOutput, NormalizeRequest, SummaryRequest, ColumnStatistics, Result } from "./types";

/** Helper regex for safe numeric token */
const NUMERIC_REGEX = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const MAX_ABS_VALUE = 1e12;

/** Validate UTF‑8 size limit (64 KiB) */
function checkSize(csv: string): void {
  const bytes = new TextEncoder().encode(csv).length;
  if (bytes > 65536) throw new Error("INPUT_TOO_LARGE");
}

/** Validate header constraints */
function validateHeaders(headers: string[]): void {
  if (headers.length === 0 || headers.length > 32) throw new Error("INVALID_CSV");
  const trimmed = headers.map((h) => h.trim());
  if (trimmed.some((h) => h.length === 0 || h.length > 100))
    throw new Error("INVALID_CSV");
  // unsafe header (formula) detection
  if (trimmed.some((h) => h.startsWith("="))) throw new Error("UNSAFE_CSV_CELL");
  const uniq = new Set(trimmed);
  if (uniq.size !== trimmed.length) throw new Error("INVALID_CSV");
}

/** Validate each row length */
function validateRows(rows: string[][], colCount: number): void {
  if (rows.length === 0 || rows.length > 500) throw new Error("INVALID_CSV");
  if (rows.some((r) => r.length !== colCount)) throw new Error("INVALID_CSV");
}

/** Normalization implementation */
function normalize(req: NormalizeRequest): ServiceOutput {
  const { inputCsv, options } = req;
  checkSize(inputCsv);
  const parsed = Papa.parse<string[]>(inputCsv, { skipEmptyLines: "greedy" });
  const [rawHeader, ...rawRows] = (parsed.data as string[][]).filter(row => row.some(cell => cell.trim() !== ""));
  if (!rawHeader) throw new Error("INVALID_CSV");
  validateHeaders(rawHeader);
  const header = rawHeader.map((h) => h.trim());
  const colCount = header.length;
  validateRows(rawRows, colCount);

  const selectedIndices: number[] = [];
  const seen = new Set<string>();
  for (const col of options.columns) {
    if (seen.has(col)) throw new Error("INVALID_OPTIONS");
    seen.add(col);
    const idx = header.findIndex((h) => h === col);
    if (idx === -1) throw new Error("INVALID_OPTIONS");
    selectedIndices.push(idx);
  }
  if (selectedIndices.length === 0 || selectedIndices.length > 32) throw new Error("INVALID_OPTIONS");

  // Process rows
  const normalizedRows = rawRows.map((row) => {
    const newRow = row.slice(); // copy
    for (const idx of selectedIndices) {
      let cell = row[idx].trim();
      if (options.caseMode === "lowercase") cell = cell.toLowerCase();
      // reject unsafe formula cells unless full numeric token
      if (cell.startsWith("=")) {
        const after = cell.slice(1);
        if (!NUMERIC_REGEX.test(after) || Math.abs(Number(after)) > MAX_ABS_VALUE || !Number.isFinite(Number(after))) {
          throw new Error("UNSAFE_CSV_CELL");
        }
      }
      newRow[idx] = cell;
    }
    return newRow;
  });

  // Simple CSV serialization without quoting
  const lines = [] as string[];
  lines.push(header.join(','));
  for (const row of normalizedRows) {
    lines.push(row.map((c) => c).join(','));
  }
  const csvNoNl = lines.join('\n');

  return {
    serviceType: "csv_normalize",
    format: "csv",
    csv: csvNoNl,
    rowCount: rawRows.length,
    columns: options.columns as readonly string[],
  };
}

/** Summary implementation */
function summarize(req: SummaryRequest): ServiceOutput {
  const { inputCsv, options } = req;
  checkSize(inputCsv);
  const parsed = Papa.parse<string[]>(inputCsv, { skipEmptyLines: "greedy" });
  const [rawHeader, ...rawRows] = (parsed.data as string[][]).filter(row => row.some(cell => cell.trim() !== ""));
  if (!rawHeader) throw new Error("INVALID_CSV");
  validateHeaders(rawHeader);
  const header = rawHeader.map((h) => h.trim());
  const colCount = header.length;
  validateRows(rawRows, colCount);

  const selectedIndices: number[] = [];
  const seen = new Set<string>();
  for (const col of options.columns) {
    if (seen.has(col)) throw new Error("INVALID_OPTIONS");
    seen.add(col);
    const idx = header.findIndex((h) => h === col);
    if (idx === -1) throw new Error("INVALID_OPTIONS");
    selectedIndices.push(idx);
  }
  if (selectedIndices.length === 0 || selectedIndices.length > 32) throw new Error("INVALID_OPTIONS");

  const stats: ColumnStatistics[] = [];
  for (let i = 0; i < selectedIndices.length; i++) {
    const idx = selectedIndices[i];
    const name = header[idx];
    let count = 0;
    let missing = 0;
    let sum = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (const row of rawRows) {
      let cell = row[idx].trim();
      if (cell === "") {
        missing++;
        continue;
      }
      // reject unsafe formula unless numeric token
      if (cell.startsWith("=")) {
        const after = cell.slice(1);
        if (!NUMERIC_REGEX.test(after) || Math.abs(Number(after)) > MAX_ABS_VALUE || !Number.isFinite(Number(after))) {
          throw new Error("UNSAFE_CSV_CELL");
        }
        cell = after; // treat as numeric
      }
      if (!NUMERIC_REGEX.test(cell)) throw new Error("INVALID_NUMBER");
      const num = Number(cell);
      if (!Number.isFinite(num) || Math.abs(num) > MAX_ABS_VALUE) throw new Error("INVALID_NUMBER");
      count++;
      sum += num;
      if (min === null || num < min) min = num;
      if (max === null || num > max) max = num;
    }
    const mean = count > 0 ? sum / count : null;
    stats.push({ name, count, missing, min, max, sum, mean });
  }

  return {
    serviceType: "csv_summary",
    format: "json",
    rowCount: rawRows.length,
    columns: stats as readonly ColumnStatistics[],
  };
}

export function runService(input: ServiceRequest): Result<ServiceOutput> {
  try {
    if (input.serviceType === "csv_normalize") {
      const output = normalize(input as NormalizeRequest);
      return { ok: true, value: output };
    } else if (input.serviceType === "csv_summary") {
      const output = summarize(input as SummaryRequest);
      return { ok: true, value: output };
    } else {
      return { ok: false, code: "INVALID_INPUT", message: "Unsupported service type" };
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const code = message || "UNKNOWN_ERROR";
    return { ok: false, code, message };
  }
}

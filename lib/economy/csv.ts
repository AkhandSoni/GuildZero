// CSV service implementation for deterministic economy kernel
import Papa from "papaparse";
import type {
  ServiceRequest,
  ServiceOutput,
  NormalizeRequest,
  SummaryRequest,
  ColumnStatistics,
  Result,
  ServiceOptions,
} from "./types";
import type { ServiceType } from "../missions";

/** Complete signed decimal or scientific numeric literal */
export const SAFE_NUMERIC_LITERAL_REGEX = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export const MAX_ABS_NUMERIC_VALUE = 1e12;
export const MAX_INPUT_CSV_BYTES = 65536; // 64 KiB
export const MAX_OUTPUT_BYTES = 131072; // 128 KiB

/** Check if a trimmed string is a valid finite numeric literal within [-1e12, 1e12] */
export function isSafeNumericLiteral(trimmed: string): boolean {
  if (!SAFE_NUMERIC_LITERAL_REGEX.test(trimmed)) {
    return false;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) && Math.abs(num) <= MAX_ABS_NUMERIC_VALUE;
}

/**
 * Check if a cell or header is an unsafe spreadsheet formula.
 * Cells/headers starting with '=', '+', '-', '@' (after leading whitespace/control chars)
 * are unsafe UNLESS the entire trimmed value is a safe finite numeric literal (e.g. "-3").
 */
export function isUnsafeFormulaValue(raw: string): boolean {
  const strippedLeading = raw.replace(/^[\s\u0000-\u001f]+/, "");
  if (strippedLeading.length === 0) {
    return false;
  }
  const first = strippedLeading[0];
  if (first === "=" || first === "@") {
    return true;
  }
  if (first === "+" || first === "-") {
    const trimmed = raw.trim();
    return !isSafeNumericLiteral(trimmed);
  }
  return false;
}

/** Validate service options against serviceType and exact CSV headers */
export function validateServiceOptions(
  serviceType: ServiceType,
  options: unknown,
  headers: readonly string[],
  strictColumnCode = false,
): Result<ServiceOptions> {
  if (options === undefined) {
    return {
      ok: false,
      code: strictColumnCode ? "OPTIONS_REQUIRED" : "INVALID_OPTIONS",
      message: "Service options are required.",
    };
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return { ok: false, code: "INVALID_OPTIONS", message: "Service options must be an object." };
  }
  const value = options as Record<string, unknown>;
  const allowedKeys = serviceType === "csv_normalize" ? ["columns", "caseMode"] : ["columns"];
  if (
    (serviceType !== "csv_normalize" && serviceType !== "csv_summary") ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    return { ok: false, code: "INVALID_OPTIONS", message: "Unsupported options for this service type." };
  }
  if (serviceType === "csv_normalize" && value.caseMode !== "preserve" && value.caseMode !== "lowercase") {
    return { ok: false, code: "INVALID_OPTIONS", message: "caseMode must be 'preserve' or 'lowercase'." };
  }

  const columns = value.columns;
  const colErrorCode = strictColumnCode ? "INVALID_COLUMNS" : "INVALID_OPTIONS";
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > 32 ||
    columns.some((col) => typeof col !== "string" || !col.trim() || col.length > 100 || !headers.includes(col)) ||
    new Set(columns).size !== columns.length
  ) {
    return {
      ok: false,
      code: colErrorCode,
      message: "Select 1-32 unique column names matching the CSV header.",
    };
  }

  return {
    ok: true,
    value:
      serviceType === "csv_normalize"
        ? { columns: [...(columns as string[])], caseMode: value.caseMode as "preserve" | "lowercase" }
        : { columns: [...(columns as string[])] },
  };
}

/** Parse and validate bounded CSV input */
export function parseBoundedCsv(inputCsv: unknown): Result<{
  rawHeader: string[];
  rawRows: string[][];
}> {
  if (typeof inputCsv !== "string") {
    return { ok: false, code: "INVALID_INPUT", message: "CSV input must be a string." };
  }
  const byteLength = new TextEncoder().encode(inputCsv).length;
  if (byteLength > MAX_INPUT_CSV_BYTES) {
    return { ok: false, code: "INPUT_TOO_LARGE", message: "CSV exceeds the 64 KiB input limit." };
  }

  const parsed = Papa.parse<string[]>(inputCsv, {
    delimiter: ",",
    skipEmptyLines: "greedy",
  });

  if (parsed.errors.length > 0) {
    return { ok: false, code: "INVALID_CSV", message: "CSV contains syntax or quoting errors." };
  }

  const [rawHeader, ...rawRows] = parsed.data;
  if (!rawHeader || rawHeader.length === 0 || rawHeader.length > 32 || rawRows.length === 0 || rawRows.length > 500) {
    return {
      ok: false,
      code: "INVALID_CSV",
      message: "CSV must have 1-32 columns and 1-500 data rows.",
    };
  }

  const trimmedHeaders = rawHeader.map((h) => h.trim());
  if (
    rawHeader.some((h) => h.length > 100) ||
    trimmedHeaders.some((h) => h.length === 0 || h.length > 100) ||
    new Set(trimmedHeaders).size !== rawHeader.length
  ) {
    return {
      ok: false,
      code: "INVALID_CSV",
      message: "CSV headers must be nonempty, at most 100 characters, and unique when trimmed.",
    };
  }

  if (rawHeader.some((h) => isUnsafeFormulaValue(h))) {
    return {
      ok: false,
      code: "UNSAFE_CSV_CELL",
      message: "CSV headers must not start with spreadsheet formula prefixes.",
    };
  }

  const colCount = rawHeader.length;
  if (rawRows.some((row) => !Array.isArray(row) || row.length !== colCount)) {
    return {
      ok: false,
      code: "INVALID_CSV",
      message: "Every CSV row must match the header column count.",
    };
  }

  return { ok: true, value: { rawHeader, rawRows } };
}

function executeNormalize(req: NormalizeRequest): Result<ServiceOutput> {
  const csvRes = parseBoundedCsv(req.inputCsv);
  if (!csvRes.ok) return csvRes;
  const { rawHeader, rawRows } = csvRes.value;

  const optRes = validateServiceOptions("csv_normalize", req.options, rawHeader, false);
  if (!optRes.ok) return optRes;
  const options = optRes.value as NormalizeRequest["options"];

  const selectedIndices = new Set<number>(options.columns.map((col) => rawHeader.indexOf(col)));

  const normalizedRows: string[][] = [];
  for (const row of rawRows) {
    const newRow: string[] = [];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const originalCell = row[colIdx];
      // Validate formula safety on every exported cell (selected and unselected)
      if (isUnsafeFormulaValue(originalCell)) {
        return {
          ok: false,
          code: "UNSAFE_CSV_CELL",
          message: "CSV contains an unsafe spreadsheet formula cell.",
        };
      }
      if (selectedIndices.has(colIdx)) {
        const trimmed = originalCell.trim();
        const transformed = options.caseMode === "lowercase" ? trimmed.toLowerCase() : trimmed;
        if (isUnsafeFormulaValue(transformed)) {
          return {
            ok: false,
            code: "UNSAFE_CSV_CELL",
            message: "Normalized CSV cell begins with an unsafe spreadsheet formula prefix.",
          };
        }
        newRow.push(transformed);
      } else {
        newRow.push(originalCell);
      }
    }
    normalizedRows.push(newRow);
  }

  const serializedCsv = Papa.unparse([rawHeader, ...normalizedRows], {
    delimiter: ",",
    newline: "\n",
    quotes: false,
  });

  if (new TextEncoder().encode(serializedCsv).length > MAX_OUTPUT_BYTES) {
    return {
      ok: false,
      code: "OUTPUT_TOO_LARGE",
      message: "Normalized CSV exceeds the 128 KiB output limit.",
    };
  }

  return {
    ok: true,
    value: {
      serviceType: "csv_normalize",
      format: "csv",
      csv: serializedCsv,
      rowCount: rawRows.length,
      columns: [...options.columns],
    },
  };
}

function executeSummarize(req: SummaryRequest): Result<ServiceOutput> {
  const csvRes = parseBoundedCsv(req.inputCsv);
  if (!csvRes.ok) return csvRes;
  const { rawHeader, rawRows } = csvRes.value;

  const optRes = validateServiceOptions("csv_summary", req.options, rawHeader, false);
  if (!optRes.ok) return optRes;
  const options = optRes.value as SummaryRequest["options"];

  const stats: ColumnStatistics[] = [];
  for (const colName of options.columns) {
    const colIdx = rawHeader.indexOf(colName);
    let count = 0;
    let missing = 0;
    let sum = 0;
    let min: number | null = null;
    let max: number | null = null;

    for (const row of rawRows) {
      const rawCell = row[colIdx];
      const trimmed = rawCell.trim();
      if (trimmed === "") {
        missing++;
        continue;
      }
      if (SAFE_NUMERIC_LITERAL_REGEX.test(trimmed)) {
        if (!isSafeNumericLiteral(trimmed)) {
          return {
            ok: false,
            code: "INVALID_NUMBER",
            message: "Summary column contains a numeric value outside the supported [-1e12, 1e12] bound.",
          };
        }
      } else if (isUnsafeFormulaValue(rawCell)) {
        return {
          ok: false,
          code: "UNSAFE_CSV_CELL",
          message: "Summary column contains an unsafe spreadsheet formula cell.",
        };
      } else {
        return {
          ok: false,
          code: "INVALID_NUMBER",
          message: "Summary column contains a non-numeric value.",
        };
      }
      const num = Number(trimmed);
      count++;
      sum += num;
      if (!Number.isFinite(sum)) {
        return {
          ok: false,
          code: "INVALID_NUMBER",
          message: "Summary computation produced a non-finite sum.",
        };
      }
      if (min === null || num < min) min = num;
      if (max === null || num > max) max = num;
    }

    const mean = count > 0 ? sum / count : null;
    stats.push({ name: colName, count, missing, min, max, sum, mean });
  }

  const output: ServiceOutput = {
    serviceType: "csv_summary",
    format: "json",
    rowCount: rawRows.length,
    columns: stats,
  };

  if (new TextEncoder().encode(JSON.stringify(output)).length > MAX_OUTPUT_BYTES) {
    return {
      ok: false,
      code: "OUTPUT_TOO_LARGE",
      message: "Summary output exceeds the 128 KiB output limit.",
    };
  }

  return { ok: true, value: output };
}

export function runService(input: ServiceRequest): Result<ServiceOutput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "ServiceRequest must be an object." };
  }
  const rec = input as Record<string, unknown>;
  const allowedTopKeys = ["serviceType", "inputCsv", "options"];
  if (Object.keys(rec).some((k) => !allowedTopKeys.includes(k))) {
    return { ok: false, code: "INVALID_OPTIONS", message: "ServiceRequest contains unknown fields." };
  }

  if (input.serviceType === "csv_normalize") {
    return executeNormalize(input);
  }
  if (input.serviceType === "csv_summary") {
    return executeSummarize(input);
  }
  return { ok: false, code: "INVALID_INPUT", message: "Unsupported service type." };
}

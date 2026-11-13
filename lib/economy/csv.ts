// CSV service implementation for deterministic economy kernel
import Papa from "papaparse";
import type {
  ServiceRequest,
  ServiceOutput,
  NormalizeRequest,
  SummaryRequest,
  ColumnStatistics,
  Result,
} from "./types";
import { validateServiceOptions } from "./contracts";
import { runBusinessService } from "./business";
export { validateServiceOptions } from "./contracts";

import {
  parseBoundedCsv, isSafeNumericLiteral, isUnsafeFormulaValue,
  MAX_OUTPUT_BYTES, SAFE_NUMERIC_LITERAL_REGEX,
} from "./csv-input";
export {
  parseBoundedCsv, isSafeNumericLiteral, isUnsafeFormulaValue,
  MAX_OUTPUT_BYTES, MAX_ABS_NUMERIC_VALUE, MAX_INPUT_CSV_BYTES, SAFE_NUMERIC_LITERAL_REGEX,
} from "./csv-input";

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
    // An empty one-column record must be quoted so it cannot be mistaken for
    // a trailing record separator by a reader or the independent verifier.
    quotes: (value) => rawHeader.length === 1 && value === "",
  });

  const output: ServiceOutput = {
    serviceType: "csv_normalize",
    format: "csv",
    csv: serializedCsv,
    rowCount: rawRows.length,
    columns: [...options.columns],
  };

  if (
    new TextEncoder().encode(serializedCsv).length > MAX_OUTPUT_BYTES ||
    new TextEncoder().encode(JSON.stringify(output)).length > MAX_OUTPUT_BYTES
  ) {
    return {
      ok: false,
      code: "OUTPUT_TOO_LARGE",
      message: "Normalized CSV deliverable exceeds the 128 KiB output limit.",
    };
  }

  return {
    ok: true,
    value: output,
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
    let correction = 0;
    let min: number | null = null;
    let max: number | null = null;

    for (const [rowIndex, row] of rawRows.entries()) {
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
            message: `Column "${colName}", CSV record ${rowIndex + 2}: number must fit within [-1e12, 1e12] without underflowing to zero.`,
          };
        }
      } else if (isUnsafeFormulaValue(rawCell)) {
        return {
          ok: false,
          code: "UNSAFE_CSV_CELL",
          message: `Column "${colName}", CSV record ${rowIndex + 2}: unsafe spreadsheet formula. Choose numeric columns only.`,
        };
      } else {
        return {
          ok: false,
          code: "INVALID_NUMBER",
          message: `Column "${colName}", CSV record ${rowIndex + 2}: non-numeric value. Select numeric columns only; cleaning trims text but does not convert it to numbers.`,
        };
      }
      const num = Number(trimmed);
      count++;
      // Neumaier compensation preserves small terms when larger values cancel.
      const next = sum + num;
      correction += Math.abs(sum) >= Math.abs(num)
        ? (sum - next) + num
        : (num - next) + sum;
      sum = next;
      if (!Number.isFinite(sum)) {
        return {
          ok: false,
          code: "INVALID_NUMBER",
          message: `Column "${colName}": summary produced a non-finite sum.`,
        };
      }
      if (min === null || num < min) min = num;
      if (max === null || num > max) max = num;
    }

    sum += correction;
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
  if (input.serviceType === "csv_validate" || input.serviceType === "csv_reconcile" || input.serviceType === "csv_report") return runBusinessService(input);
  return { ok: false, code: "INVALID_INPUT", message: "Unsupported service type." };
}

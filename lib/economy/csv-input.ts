import Papa from "papaparse";
import type { Result } from "./types";

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

  // Only record separators outside quoted fields must agree. Embedded CR/LF
  // belongs to a field and may differ from the file's record separator.
  let newline: "\n" | "\r" | "\r\n" | undefined;
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < inputCsv.length; i++) {
    const ch = inputCsv[i];
    if (quoted) {
      if (ch === '"') {
        if (inputCsv[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (ch === "\r" || ch === "\n") {
      const separator = ch === "\r" && inputCsv[i + 1] === "\n" ? "\r\n" : ch;
      if (newline !== undefined && separator !== newline)
        return { ok: false, code: "INVALID_CSV", message: "Use consistent CSV record separators outside quoted fields." };
      newline = separator;
      if (separator === "\r\n") i++;
      fieldStart = true;
    } else {
      fieldStart = ch === ",";
    }
  }
  const parsed = Papa.parse<string[]>(inputCsv, {
    delimiter: ",",
    newline: newline ?? "\n",
    skipEmptyLines: false,
  });

  // Papa adds an empty record for a terminal separator. Remove that artifact
  // once; explicit empty records (including one-column records) remain data.
  const last = parsed.data.at(-1);
  if (newline && inputCsv.endsWith(newline) && last?.length === 1 && last[0] === "")
    parsed.data.pop();

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


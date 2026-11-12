// Independent deliverable verification for deterministic economy kernel
// Never imports or invokes runService / executeNormalize / executeSummarize.
import Papa from "papaparse";
import type {
  VerificationRequest,
  VerificationResult,
  CheckResult,
  Result,
} from "./types";
import {
  isSafeNumericLiteral,
  isUnsafeFormulaValue,
  MAX_OUTPUT_BYTES,
  parseBoundedCsv,
  SAFE_NUMERIC_LITERAL_REGEX,
  validateServiceOptions,
} from "./csv";

export const STAT_COMPARISON_TOLERANCE = 1e-9;

function check(code: string, passed: boolean, detail: string): CheckResult {
  return { code, passed, detail };
}

/** Compare finite numbers within abs(actual - expected) <= 1e-9 * max(1, abs(expected)) */
export function withinStatTolerance(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }
  return Math.abs(actual - expected) <= STAT_COMPARISON_TOLERANCE * Math.max(1, Math.abs(expected));
}

function hasExactKeys(obj: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(obj);
  return keys.length === expectedKeys.length && expectedKeys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

export function verifyDeliverable(input: VerificationRequest): Result<VerificationResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "VerificationRequest must be an object." };
  }

  const { request, deliverable } = input;
  if (!request || typeof request !== "object" || Array.isArray(request) || !("serviceType" in request)) {
    return { ok: false, code: "INVALID_INPUT", message: "Malformed service request in verification input." };
  }

  const reqRec = request as Record<string, unknown>;
  const allowedReqKeys = ["serviceType", "inputCsv", "options", "acceptanceCriteria", "unsupportedCriteria"];
  if (Object.keys(reqRec).some((k) => !allowedReqKeys.includes(k))) {
    return { ok: false, code: "INVALID_OPTIONS", message: "ServiceRequest contains unknown fields." };
  }

  if (request.serviceType !== "csv_normalize" && request.serviceType !== "csv_summary") {
    return { ok: false, code: "INVALID_INPUT", message: "Unsupported serviceType in verification request." };
  }

  // Validate input CSV and options at the request boundary
  const sourceCsvRes = parseBoundedCsv(request.inputCsv);
  if (!sourceCsvRes.ok) {
    return sourceCsvRes;
  }
  const { rawHeader, rawRows } = sourceCsvRes.value;

  const optRes = validateServiceOptions(request.serviceType, request.options, rawHeader, false);
  if (!optRes.ok) {
    return optRes;
  }

  const checks: CheckResult[] = [];

  // Validate deliverable is a plain object
  if (typeof deliverable !== "object" || deliverable === null || Array.isArray(deliverable)) {
    checks.push(check("INVALID_DELIVERABLE", false, "Deliverable is not a JSON object."));
    return {
      ok: true,
      value: {
        verdict: "fail",
        reasonCode: "CONTENT_MISMATCH",
        checks,
      },
    };
  }

  let serializedDeliverable: string;
  try {
    serializedDeliverable = JSON.stringify(deliverable);
  } catch {
    checks.push(check("INVALID_DELIVERABLE", false, "Deliverable is not JSON-serializable."));
    return {
      ok: true,
      value: {
        verdict: "fail",
        reasonCode: "CONTENT_MISMATCH",
        checks,
      },
    };
  }

  if (new TextEncoder().encode(serializedDeliverable).length > MAX_OUTPUT_BYTES) {
    checks.push(check("OUTPUT_SIZE_BOUND", false, "Deliverable exceeds 128 KiB limit."));
    return {
      ok: true,
      value: {
        verdict: "fail",
        reasonCode: "OUTPUT_TOO_LARGE",
        checks,
      },
    };
  }

  const delivRec = deliverable as Record<string, unknown>;

  if (request.serviceType === "csv_normalize") {
    const options = optRes.value as { columns: readonly string[]; caseMode: "preserve" | "lowercase" };

    // Verify source cells are formula-safe (request validity)
    for (const row of rawRows) {
      for (const cell of row) {
        if (isUnsafeFormulaValue(cell)) {
          return {
            ok: false,
            code: "UNSAFE_CSV_CELL",
            message: "Source CSV contains an unsafe spreadsheet formula cell.",
          };
        }
      }
    }

    const schemaOk = hasExactKeys(delivRec, ["serviceType", "format", "csv", "rowCount", "columns"]);
    checks.push(check("SCHEMA_KEYS_MATCH", schemaOk, "Expected csv_normalize deliverable keys."));

    const typeMatch = delivRec.serviceType === "csv_normalize";
    checks.push(check("SERVICE_TYPE_MATCH", typeMatch, "expected csv_normalize"));

    const formatMatch = delivRec.format === "csv";
    checks.push(check("FORMAT_MATCH", formatMatch, "expected csv"));

    const colsMatch =
      Array.isArray(delivRec.columns) &&
      delivRec.columns.length === options.columns.length &&
      delivRec.columns.every((c, idx) => c === options.columns[idx]);
    checks.push(check("COLUMNS_MATCH", colsMatch, `expected [${options.columns.join(", ")}]`));

    const reportedRowsMatch =
      typeof delivRec.rowCount === "number" &&
      Number.isSafeInteger(delivRec.rowCount) &&
      delivRec.rowCount === rawRows.length;
    checks.push(check("ROW_COUNT_MATCH", reportedRowsMatch, `expected ${rawRows.length} rows`));

    // Independently parse and verify the submitted CSV string cell by cell
    let parsedRowsMatch = false;
    let contentMatch = false;
    let formulaSafe = true;

    if (
      typeof delivRec.csv === "string" &&
      new TextEncoder().encode(delivRec.csv).length <= MAX_OUTPUT_BYTES &&
      !delivRec.csv.endsWith("\n") &&
      !delivRec.csv.endsWith("\r") &&
      !delivRec.csv.includes("\r\n")
    ) {
      const parsedOut = Papa.parse<string[]>(delivRec.csv, {
        delimiter: ",",
        skipEmptyLines: false,
      });

      if (parsedOut.errors.length === 0 && parsedOut.data.length === rawRows.length + 1) {
        const [outHeader, ...outRows] = parsedOut.data;
        parsedRowsMatch = outRows.length === rawRows.length;

        const headerMatches =
          Array.isArray(outHeader) &&
          outHeader.length === rawHeader.length &&
          outHeader.every((h, idx) => h === rawHeader[idx] && !isUnsafeFormulaValue(h));

        if (headerMatches && outRows.every((r) => Array.isArray(r) && r.length === rawHeader.length)) {
          const selectedColPositions = new Array<boolean>(rawHeader.length).fill(false);
          for (const colName of options.columns) {
            const pos = rawHeader.indexOf(colName);
            if (pos >= 0) selectedColPositions[pos] = true;
          }

          let allCellsMatch = true;
          for (let r = 0; r < rawRows.length; r++) {
            for (let c = 0; c < rawHeader.length; c++) {
              const actualCell = outRows[r][c];
              if (isUnsafeFormulaValue(actualCell)) {
                formulaSafe = false;
                allCellsMatch = false;
                break;
              }
              const srcCell = rawRows[r][c];
              const expectedCell = selectedColPositions[c]
                ? options.caseMode === "lowercase"
                  ? srcCell.trim().toLowerCase()
                  : srcCell.trim()
                : srcCell;
              if (actualCell !== expectedCell) {
                allCellsMatch = false;
                break;
              }
            }
            if (!allCellsMatch) break;
          }
          contentMatch = allCellsMatch;
        }
      }
    }

    checks.push(check("PARSED_ROW_COUNT_MATCH", parsedRowsMatch, `parsed ${rawRows.length} data rows`));
    checks.push(check("FORMULA_SAFETY", formulaSafe, "All exported CSV cells are formula-safe."));
    checks.push(check("CONTENT_MATCH", contentMatch, "Independent cell-by-cell CSV verification."));

    if (!formulaSafe) {
      return {
        ok: true,
        value: {
          verdict: "fail",
          reasonCode: "UNSAFE_CSV_CELL",
          checks,
        },
      };
    }

    if (!reportedRowsMatch || !parsedRowsMatch) {
      return {
        ok: true,
        value: {
          verdict: "fail",
          reasonCode: "ROW_COUNT_MISMATCH",
          checks,
        },
      };
    }

    const allPass = checks.every((c) => c.passed);
    if (!allPass) {
      return {
        ok: true,
        value: {
          verdict: "fail",
          reasonCode: "CONTENT_MISMATCH",
          checks,
        },
      };
    }
  } else {
    // csv_summary independent verification
    const options = optRes.value as { columns: readonly string[] };

    // Independently extract numeric vectors per requested column and reduce
    const expectedStats: {
      name: string;
      count: number;
      missing: number;
      min: number | null;
      max: number | null;
      sum: number;
      mean: number | null;
    }[] = [];

    for (const colName of options.columns) {
      const colIdx = rawHeader.indexOf(colName);
      const values: number[] = [];
      let missing = 0;

      for (let r = 0; r < rawRows.length; r++) {
        const rawCell = rawRows[r][colIdx];
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
              message: "Source CSV contains an out-of-range number in a summarized column.",
            };
          }
        } else if (isUnsafeFormulaValue(rawCell)) {
          return {
            ok: false,
            code: "UNSAFE_CSV_CELL",
            message: "Source CSV contains an unsafe formula in a summarized column.",
          };
        } else {
          return {
            ok: false,
            code: "INVALID_NUMBER",
            message: "Source CSV contains an invalid number in a summarized column.",
          };
        }
        values.push(Number(trimmed));
      }

      const count = values.length;
      if (count === 0) {
        expectedStats.push({
          name: colName,
          count: 0,
          missing,
          min: null,
          max: null,
          sum: 0,
          mean: null,
        });
      } else {
        const sorted = [...values].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const sum = values.reduce((acc, v) => acc + v, 0);
        if (!Number.isFinite(sum)) {
          return {
            ok: false,
            code: "INVALID_NUMBER",
            message: "Summary column sum is non-finite.",
          };
        }
        const mean = sum / count;
        expectedStats.push({ name: colName, count, missing, min, max, sum, mean });
      }
    }

    const schemaOk = hasExactKeys(delivRec, ["serviceType", "format", "rowCount", "columns"]);
    checks.push(check("SCHEMA_KEYS_MATCH", schemaOk, "Expected csv_summary deliverable keys."));

    const typeMatch = delivRec.serviceType === "csv_summary";
    checks.push(check("SERVICE_TYPE_MATCH", typeMatch, "expected csv_summary"));

    const formatMatch = delivRec.format === "json";
    checks.push(check("FORMAT_MATCH", formatMatch, "expected json"));

    const rowsMatch =
      typeof delivRec.rowCount === "number" &&
      Number.isSafeInteger(delivRec.rowCount) &&
      delivRec.rowCount === rawRows.length;
    checks.push(check("ROW_COUNT_MATCH", rowsMatch, `expected ${rawRows.length} rows`));

    const gotCols = delivRec.columns;
    const colsArrayOk = Array.isArray(gotCols) && gotCols.length === expectedStats.length;
    let colNamesAndSchemaOk = colsArrayOk;
    let statsValuesOk = colsArrayOk;

    if (colsArrayOk) {
      const seenNames = new Set<string>();
      for (let i = 0; i < expectedStats.length; i++) {
        const exp = expectedStats[i];
        const gotRaw = gotCols[i];
        if (!gotRaw || typeof gotRaw !== "object" || Array.isArray(gotRaw)) {
          colNamesAndSchemaOk = false;
          statsValuesOk = false;
          break;
        }
        const got = gotRaw as Record<string, unknown>;
        if (!hasExactKeys(got, ["name", "count", "missing", "min", "max", "sum", "mean"])) {
          colNamesAndSchemaOk = false;
          statsValuesOk = false;
          break;
        }
        if (typeof got.name !== "string" || got.name !== exp.name || seenNames.has(got.name)) {
          colNamesAndSchemaOk = false;
          statsValuesOk = false;
          break;
        }
        seenNames.add(got.name);

        const countsMatch =
          typeof got.count === "number" &&
          Number.isSafeInteger(got.count) &&
          got.count === exp.count &&
          typeof got.missing === "number" &&
          Number.isSafeInteger(got.missing) &&
          got.missing === exp.missing &&
          got.count + got.missing === rawRows.length;

        const sumMatches = typeof got.sum === "number" && withinStatTolerance(got.sum, exp.sum);

        let minMaxMeanMatch = false;
        if (exp.count === 0) {
          minMaxMeanMatch = got.min === null && got.max === null && got.mean === null;
        } else {
          minMaxMeanMatch =
            typeof got.min === "number" &&
            withinStatTolerance(got.min, exp.min as number) &&
            typeof got.max === "number" &&
            withinStatTolerance(got.max, exp.max as number) &&
            typeof got.mean === "number" &&
            withinStatTolerance(got.mean, exp.mean as number);
        }

        if (!countsMatch || !sumMatches || !minMaxMeanMatch) {
          statsValuesOk = false;
        }
      }
    }

    checks.push(check("COLUMNS_MATCH", colNamesAndSchemaOk, "Summary column names and schema match request."));
    checks.push(check("STATISTICS_MATCH", statsValuesOk, "Summary statistics match within tolerance."));

    if (!rowsMatch) {
      return {
        ok: true,
        value: {
          verdict: "fail",
          reasonCode: "ROW_COUNT_MISMATCH",
          checks,
        },
      };
    }

    if (!schemaOk || !typeMatch || !formatMatch || !colNamesAndSchemaOk) {
      return {
        ok: true,
        value: {
          verdict: "fail",
          reasonCode: "CONTENT_MISMATCH",
          checks,
        },
      };
    }

    if (!statsValuesOk) {
      return {
        ok: true,
        value: {
          verdict: "fail",
          reasonCode: "STATISTICS_MISMATCH",
          checks,
        },
      };
    }
  }

  // Objective checks passed. Check if unsupported subjective acceptance criteria require human review.
  const subjectiveCriteria =
    (typeof input.unsupportedCriteria === "string" && input.unsupportedCriteria.trim()) ||
    (typeof input.acceptanceCriteria === "string" && input.acceptanceCriteria.trim()) ||
    (typeof reqRec.unsupportedCriteria === "string" && (reqRec.unsupportedCriteria as string).trim()) ||
    (typeof reqRec.acceptanceCriteria === "string" && (reqRec.acceptanceCriteria as string).trim()) ||
    "";

  if (subjectiveCriteria.length > 0) {
    checks.push(
      check(
        "UNSUPPORTED_CRITERIA",
        false,
        "Subjective or free-text acceptance criteria cannot be auto-approved and require human review.",
      ),
    );
    return {
      ok: true,
      value: {
        verdict: "needs_human",
        reasonCode: "UNSUPPORTED_CRITERIA",
        checks,
      },
    };
  }

  return {
    ok: true,
    value: {
      verdict: "pass",
      reasonCode: "VERIFICATION_PASSED",
      checks,
    },
  };
}

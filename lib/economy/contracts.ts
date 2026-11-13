import type { ServiceType } from "../missions";
import type { Result, ServiceOptions } from "./types";
import { SERVICE_TYPES } from "../services";
import { parseBoundedCsv } from "./csv-input";

/** Headers are exact CSV names, including whitespace. Never silently rename them. */
export function validateServiceOptions(
  serviceType: ServiceType,
  options: unknown,
  headers: readonly string[],
  strictColumnCode = true,
): Result<ServiceOptions> {
  if (options === undefined)
    return { ok: false, code: strictColumnCode ? "OPTIONS_REQUIRED" : "INVALID_OPTIONS", message: "Save processing options before opening an auction." };
  if (!options || typeof options !== "object" || Array.isArray(options))
    return { ok: false, code: "INVALID_OPTIONS", message: "Processing options must be an object." };
  const value = options as Record<string, unknown>;
  if (!SERVICE_TYPES.includes(serviceType))
    return { ok: false, code: "INVALID_OPTIONS", message: "Unsupported service template." };
  const extras: Record<ServiceType, string[]> = { csv_normalize: ["caseMode"], csv_summary: [], csv_validate: ["numericColumns"], csv_reconcile: ["keyColumn", "comparisonCsv"], csv_report: ["groupBy"] };
  const allowed = ["columns", ...(extras[serviceType] ?? [])];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    (serviceType === "csv_normalize" && value.caseMode !== "preserve" && value.caseMode !== "lowercase")
  )
    return { ok: false, code: "INVALID_OPTIONS", message: "Use only the supported options for this service template." };
  const columns = value.columns;
  if (!Array.isArray(columns) || !columns.length || columns.length > 32 ||
      columns.some((column) => typeof column !== "string" || !column.trim() || column.length > 100 || !headers.includes(column)) ||
      new Set(columns).size !== columns.length)
    return { ok: false, code: strictColumnCode ? "INVALID_COLUMNS" : "INVALID_OPTIONS", message: "Select 1–32 unique column names from the input CSV." };
  if (serviceType === "csv_validate") {
    const numeric = value.numericColumns;
    if (!Array.isArray(numeric) || numeric.some(c => typeof c !== "string" || !columns.includes(c)) || new Set(numeric).size !== numeric.length)
      return { ok: false, code: "INVALID_OPTIONS", message: "Numeric checks must name unique selected columns." };
    return { ok: true, value: { columns: [...columns], numericColumns: [...numeric] } };
  }
  if (serviceType === "csv_report") {
    if (typeof value.groupBy !== "string" || !headers.includes(value.groupBy) || columns.includes(value.groupBy))
      return { ok: false, code: "INVALID_OPTIONS", message: "Choose a grouping column separate from the numeric measures." };
    return { ok: true, value: { columns: [...columns], groupBy: value.groupBy } };
  }
  if (serviceType === "csv_reconcile") {
    if (typeof value.comparisonCsv !== "string") return { ok: false, code: "INVALID_OPTIONS", message: "Upload or paste the comparison CSV." };
    const other = parseBoundedCsv(value.comparisonCsv);
    if (!other.ok) return { ...other, message: `Comparison CSV: ${other.message}` };
    if (typeof value.keyColumn !== "string" || !headers.includes(value.keyColumn) || !other.value.rawHeader.includes(value.keyColumn) || columns.includes(value.keyColumn) || columns.some(c => !other.value.rawHeader.includes(c)))
      return { ok: false, code: "INVALID_OPTIONS", message: "Choose one shared key and shared comparison columns; exclude the key from compared values." };
    return { ok: true, value: { columns: [...columns], keyColumn: value.keyColumn, comparisonCsv: value.comparisonCsv } };
  }
  return {
    ok: true,
    value: serviceType === "csv_normalize"
      ? { columns: [...columns], caseMode: value.caseMode as "preserve" | "lowercase" }
      : { columns: [...columns] },
  };
}

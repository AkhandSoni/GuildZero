import type { ServiceType } from "../missions";
import type { Result, ServiceOptions } from "./types";

/** Headers are exact CSV names, including whitespace. Never silently rename them. */
export function validateServiceOptions(
  serviceType: ServiceType,
  options: unknown,
  headers: readonly string[],
): Result<ServiceOptions> {
  if (options === undefined)
    return { ok: false, code: "OPTIONS_REQUIRED", message: "Save processing options before opening an auction." };
  if (!options || typeof options !== "object" || Array.isArray(options))
    return { ok: false, code: "INVALID_OPTIONS", message: "Processing options must be an object." };
  const value = options as Record<string, unknown>;
  const allowed = serviceType === "csv_normalize" ? ["columns", "caseMode"] : ["columns"];
  if (
    !["csv_normalize", "csv_summary"].includes(serviceType) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    (serviceType === "csv_normalize" && value.caseMode !== "preserve" && value.caseMode !== "lowercase")
  )
    return { ok: false, code: "INVALID_OPTIONS", message: "Use only the supported options for this service template." };
  const columns = value.columns;
  if (!Array.isArray(columns) || !columns.length || columns.length > 32 ||
      columns.some((column) => typeof column !== "string" || !column.trim() || column.length > 100 || !headers.includes(column)) ||
      new Set(columns).size !== columns.length)
    return { ok: false, code: "INVALID_COLUMNS", message: "Select 1–32 unique column names from the input CSV." };
  return {
    ok: true,
    value: serviceType === "csv_normalize"
      ? { columns: [...columns], caseMode: value.caseMode as "preserve" | "lowercase" }
      : { columns: [...columns] },
  };
}

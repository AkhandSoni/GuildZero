import { parseBoundedCsv, isSafeNumericLiteral, MAX_OUTPUT_BYTES } from "./csv-input";
import { validateServiceOptions } from "./contracts";
import type { BusinessRequest, Result, ServiceOptions, ServiceRequest } from "./types";
import type { ServiceType } from "../services";

export const isBusinessService = (service: string) => ["csv_validate", "csv_reconcile", "csv_report"].includes(service);
export const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Options were validated on save; each executor/verifier validates them again. */
export function serviceRequest(serviceType: ServiceType, inputCsv: string, options: ServiceOptions): ServiceRequest {
  return { serviceType, inputCsv, options } as ServiceRequest;
}

export function validateBusinessInput(request: BusinessRequest): Result<null> {
  const source = parseBoundedCsv(request.inputCsv);
  if (!source.ok) return source;
  const options = validateServiceOptions(request.serviceType, request.options, source.value.rawHeader);
  if (!options.ok) return options;
  if (request.serviceType === "csv_report") {
    const index = source.value.rawHeader.indexOf(request.options.groupBy);
    const keys = source.value.rawRows.map(row => row[index]);
    if (keys.some(key => key.length > 100) || new Set(keys).size > 50 || new Set(keys).size * request.options.columns.length > 128)
      return { ok: false, code: "INVALID_INPUT", message: "Grouped reports allow at most 50 groups, 128 group/measure combinations, and labels up to 100 characters." };
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    const maximumOutput = 1024 + bytes(request.options.columns) + [...new Set(keys)].reduce((size, key) => size + bytes(key) + 64 + request.options.columns.reduce((n, column) => n + bytes(column) + 512, 0), 0);
    if (maximumOutput > MAX_OUTPUT_BYTES) return { ok: false, code: "OUTPUT_TOO_LARGE", message: "Select fewer groups or measures to keep the complete report within 128 KiB." };
    for (const column of request.options.columns) {
      const i = source.value.rawHeader.indexOf(column);
      const invalid = source.value.rawRows.findIndex(row => row[i].trim() !== "" && !isSafeNumericLiteral(row[i].trim()));
      if (invalid !== -1) return { ok: false, code: "INVALID_NUMBER", message: `Column "${column}", CSV record ${invalid + 2}: use blank cells or plain finite numbers within ±1e12 without underflow.` };
    }
  }
  if (request.serviceType === "csv_reconcile") {
    const other = parseBoundedCsv(request.options.comparisonCsv);
    if (!other.ok) return other;
    for (const [label, csv] of [["Primary", source.value], ["Comparison", other.value]] as const) {
      const index = csv.rawHeader.indexOf(request.options.keyColumn);
      const seen = new Set<string>();
      for (const [i, row] of csv.rawRows.entries()) {
        const key = row[index];
        if (!key.trim() || key.length > 100 || seen.has(key))
          return { ok: false, code: "INVALID_INPUT", message: `${label} CSV record ${i + 2}: keys must be nonblank, unique and at most 100 characters. Matching is exact and case-sensitive; whitespace is significant.` };
        seen.add(key);
      }
    }
  }
  return { ok: true, value: null };
}

// Reference computation is deliberately independent of business.ts and runService.
import { parseBoundedCsv, isSafeNumericLiteral, MAX_OUTPUT_BYTES } from "./csv-input";
import { validateBusinessInput, lexical } from "./business-input";
import type { BusinessRequest, BusinessOutput, QualityExample, Result, VerificationResult } from "./types";

function referenceSum(values: number[]) {
  const partials: number[] = [];
  for (let value of values) {
    let retained = 0;
    for (let part of partials) {
      if (Math.abs(value) < Math.abs(part)) [value, part] = [part, value];
      const high = value + part, low = part - (high - value);
      if (low) partials[retained++] = low;
      value = high;
    }
    partials.length = retained; partials.push(value);
  }
  return partials.reduce((a,b) => a+b, 0);
}

/** Exact schema/count/text comparison; only sum and mean permit numeric tolerance. */
function matches(actual: unknown, expected: unknown, key = ""): boolean {
  if (typeof expected === "number" && ["sum", "mean"].includes(key))
    return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((v,i) => matches(actual[i],v));
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const a = actual as Record<string, unknown>, e = expected as Record<string, unknown>;
    return Object.keys(a).length === Object.keys(e).length && Object.keys(e).every(k => Object.hasOwn(a,k) && matches(a[k],e[k],k));
  }
  return actual === expected;
}

export function verifyBusinessDeliverable(request: BusinessRequest, actual: unknown, subjective: boolean): Result<VerificationResult> {
  const valid = validateBusinessInput(request);
  if (!valid.ok) return valid;
  const source = parseBoundedCsv(request.inputCsv);
  if (!source.ok) return source;
  const { rawRows: rows, rawHeader: headers } = source.value;
  const columns = [...request.options.columns];
  let expected: BusinessOutput;
  if (request.serviceType === "csv_validate") {
    const findings: QualityExample[] = [];
    const checks = columns.map(name => {
      const cells = rows.map(row => row[headers.indexOf(name)]);
      const numeric = request.options.numericColumns.includes(name);
      cells.forEach((cell,i) => {
        const rules: QualityExample["rule"][] = [];
        if (!cell.trim()) rules.push("missing");
        else {
          if (cells.slice(0,i).includes(cell)) rules.push("duplicate");
          if (numeric && !isSafeNumericLiteral(cell.trim())) rules.push("non_numeric");
        }
        if (cell !== cell.trim()) rules.push("whitespace");
        rules.forEach(rule => findings.push({ record: i+2, column: name, rule }));
      });
      const populated = cells.filter(cell => cell.trim() !== "");
      return { name, missing: cells.length - populated.length, duplicates: populated.length - new Set(populated).size,
        distinct: new Set(populated).size, whitespace: cells.filter(c => c !== c.trim()).length,
        invalidNumeric: numeric ? populated.filter(c => !isSafeNumericLiteral(c.trim())).length : null };
    });
    expected = { serviceType: "csv_validate", format: "json", rowCount: rows.length, columns, checks,
      examples: findings.slice(0,100), examplesTruncated: findings.length > 100 };
  } else if (request.serviceType === "csv_report") {
    const index = headers.indexOf(request.options.groupBy);
    const keys = [...new Set(rows.map(row => row[index]))].sort(lexical);
    expected = { serviceType: "csv_report", format: "json", rowCount: rows.length, columns, groupBy: request.options.groupBy,
      groups: keys.map(key => {
        const group = rows.filter(row => row[index] === key);
        return { key, rowCount: group.length, statistics: columns.map(name => {
          const values = group.map(row => row[headers.indexOf(name)].trim()).filter(Boolean).map(Number);
          const sum = referenceSum(values), sorted = [...values].sort((a,b) => a-b);
          return { name, count: values.length, missing: group.length - values.length, min: sorted[0] ?? null,
            max: sorted.at(-1) ?? null, sum, mean: values.length ? sum / values.length : null };
        }) };
      }) };
  } else {
    const other = parseBoundedCsv(request.options.comparisonCsv);
    if (!other.ok) return other;
    const li = headers.indexOf(request.options.keyColumn), ri = other.value.rawHeader.indexOf(request.options.keyColumn);
    const keys = [...new Set([...rows.map(row => row[li]), ...other.value.rawRows.map(row => row[ri])])].sort(lexical);
    const comparisons = keys.map(key => {
      const left = rows.find(row => row[li] === key), right = other.value.rawRows.find(row => row[ri] === key);
      const changes = left && right ? columns.filter(name => left[headers.indexOf(name)] !== right[other.value.rawHeader.indexOf(name)]).map(column => {
        const a = left[headers.indexOf(column)], b = right[other.value.rawHeader.indexOf(column)];
        return { column, left: a.slice(0,80), right: b.slice(0,80), truncated: a.length > 80 || b.length > 80 };
      }) : [];
      const status = !left ? "right_only" as const : !right ? "left_only" as const : changes.length ? "changed" as const : "unchanged" as const;
      return { key, status, totalChangedColumns: changes.length, changes: changes.slice(0,3) };
    });
    const differing = comparisons.filter(c => c.status !== "unchanged");
    expected = { serviceType: "csv_reconcile", format: "json", rowCount: rows.length, comparisonRowCount: other.value.rawRows.length, columns, keyColumn: request.options.keyColumn,
      counts: { unchanged: comparisons.filter(c => c.status === "unchanged").length, changed: comparisons.filter(c => c.status === "changed").length,
        leftOnly: comparisons.filter(c => c.status === "left_only").length, rightOnly: comparisons.filter(c => c.status === "right_only").length },
      examples: differing.slice(0,25) as Extract<BusinessOutput, {serviceType: "csv_reconcile"}>["examples"], examplesTruncated: differing.length > 25 };
  }
  // Independently apply the documented byte cap to the reference example prefix.
  if (expected.serviceType !== "csv_report") {
    const allExamples = expected.examples;
    for (let count = allExamples.length; count >= 0; count--) {
      const candidate = { ...expected, examples: allExamples.slice(0,count), examplesTruncated: expected.examplesTruncated || count < allExamples.length };
      if (new TextEncoder().encode(JSON.stringify(candidate)).length <= MAX_OUTPUT_BYTES) {
        expected = candidate as BusinessOutput; break;
      }
    }
  }
  let bounded = false;
  try { bounded = new TextEncoder().encode(JSON.stringify(actual)).length <= MAX_OUTPUT_BYTES; } catch { /* Invalid JSON cannot verify. */ }
  const passed = bounded && matches(actual, expected);
  return { ok: true, value: { verdict: !passed ? "fail" : subjective ? "needs_human" : "pass",
    reasonCode: !passed ? "CONTENT_MISMATCH" : subjective ? "UNSUPPORTED_CRITERIA" : "VERIFICATION_PASSED",
    checks: [{ code: "BUSINESS_RESULT_MATCHES_INPUT", passed, detail: passed ? "Schema, counts, ordering, bounded examples and computed results independently match the saved inputs and options." : "Stored report does not match the independently computed reference result." }] } };
}

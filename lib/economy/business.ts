import { parseBoundedCsv, isSafeNumericLiteral, MAX_OUTPUT_BYTES } from "./csv-input";
import { lexical, validateBusinessInput } from "./business-input";
import type { BusinessRequest, BusinessOutput, QualityExample, ReconcileExample, ColumnStatistics, Result } from "./types";

function statistics(name: string, cells: string[]): ColumnStatistics {
  const values = cells.filter(cell => cell.trim() !== "").map(Number);
  let sum = 0, correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  sum += correction;
  return { name, count: values.length, missing: cells.length - values.length, min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null, sum, mean: values.length ? sum / values.length : null };
}

export function runBusinessService(request: BusinessRequest): Result<BusinessOutput> {
  const valid = validateBusinessInput(request);
  if (!valid.ok) return valid;
  const source = parseBoundedCsv(request.inputCsv);
  if (!source.ok) return source;
  const { rawHeader: headers, rawRows: rows } = source.value;
  const columns = [...request.options.columns];
  let output: BusinessOutput;
  if (request.serviceType === "csv_validate") {
    const examples: QualityExample[] = [];
    let findings = 0;
    const checks = columns.map(name => {
      const index = headers.indexOf(name), seen = new Set<string>();
      const numeric = request.options.numericColumns.includes(name);
      let missing = 0, duplicates = 0, whitespace = 0, invalidNumeric = 0;
      for (const [i, row] of rows.entries()) {
        const value = row[index], trimmed = value.trim();
        const rules: QualityExample["rule"][] = [];
        if (!trimmed) { missing++; rules.push("missing"); }
        else {
          if (seen.has(value)) { duplicates++; rules.push("duplicate"); }
          seen.add(value);
          if (numeric && !isSafeNumericLiteral(trimmed)) { invalidNumeric++; rules.push("non_numeric"); }
        }
        if (value !== trimmed) { whitespace++; rules.push("whitespace"); }
        for (const rule of rules) {
          findings++;
          if (examples.length < 100) examples.push({ record: i + 2, column: name, rule });
        }
      }
      return { name, missing, duplicates, distinct: seen.size, whitespace, invalidNumeric: numeric ? invalidNumeric : null };
    });
    output = { serviceType: "csv_validate", format: "json", rowCount: rows.length, columns, checks, examples, examplesTruncated: findings > examples.length };
  } else if (request.serviceType === "csv_report") {
    const index = headers.indexOf(request.options.groupBy);
    const groups = new Map<string, string[][]>();
    for (const row of rows) {
      const key = row[index];
      const group = groups.get(key) ?? [];
      group.push(row); groups.set(key, group);
    }
    output = { serviceType: "csv_report", format: "json", rowCount: rows.length, columns, groupBy: request.options.groupBy,
      groups: [...groups].sort(([a], [b]) => lexical(a,b)).map(([key, group]) => ({ key, rowCount: group.length,
        statistics: columns.map(name => statistics(name, group.map(row => row[headers.indexOf(name)]))) })) };
  } else {
    const comparison = parseBoundedCsv(request.options.comparisonCsv);
    if (!comparison.ok) return comparison;
    const rightHeaders = comparison.value.rawHeader;
    const left = new Map(rows.map(row => [row[headers.indexOf(request.options.keyColumn)], row]));
    const right = new Map(comparison.value.rawRows.map(row => [row[rightHeaders.indexOf(request.options.keyColumn)], row]));
    const counts = { unchanged: 0, changed: 0, leftOnly: 0, rightOnly: 0 };
    const examples: ReconcileExample[] = [];
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort(lexical)) {
      const a = left.get(key), b = right.get(key);
      if (!a || !b) {
        counts[a ? "leftOnly" : "rightOnly"]++;
        if (examples.length < 25) examples.push({ key, status: a ? "left_only" : "right_only", totalChangedColumns: 0, changes: [] });
      } else {
        const changed = columns.filter(name => a[headers.indexOf(name)] !== b[rightHeaders.indexOf(name)]);
        if (!changed.length) { counts.unchanged++; continue; }
        counts.changed++;
        if (examples.length < 25) examples.push({ key, status: "changed", totalChangedColumns: changed.length, changes: changed.slice(0,3).map(column => {
          const l = a[headers.indexOf(column)], r = b[rightHeaders.indexOf(column)];
          return { column, left: l.slice(0,80), right: r.slice(0,80), truncated: l.length > 80 || r.length > 80 };
        }) });
      }
    }
    output = { serviceType: "csv_reconcile", format: "json", rowCount: rows.length, comparisonRowCount: right.size, columns,
      keyColumn: request.options.keyColumn, counts, examples, examplesTruncated: counts.changed + counts.leftOnly + counts.rightOnly > examples.length };
  }
  while (output.serviceType !== "csv_report" && output.examples.length && new TextEncoder().encode(JSON.stringify(output)).length > MAX_OUTPUT_BYTES) {
    output.examples.pop(); output.examplesTruncated = true;
  }
  if (new TextEncoder().encode(JSON.stringify(output)).length > MAX_OUTPUT_BYTES)
    return { ok: false, code: "OUTPUT_TOO_LARGE", message: "Report exceeds the 128 KiB output bound. Select fewer columns." };
  return { ok: true, value: output };
}

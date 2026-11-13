import { expect, it } from "vitest";
import { nearToYocto, validateBudget } from "../../lib/money";
import { parseNonNegativeYocto, parsePositiveYocto } from "../../lib/economy/costs";
import { parseBoundedCsv } from "../../lib/economy/csv-input";
import { runService, verifyDeliverable } from "../../lib/economy";
import { testnetAccount, yocto } from "../../lib/settlement/policy";
import Papa from "papaparse";

it("rejects trailing line terminators in canonical money and account identifiers", () => {
  for (const ending of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    expect(() => validateBudget(`1${ending}`)).toThrow();
    expect(() => nearToYocto(`1${ending}`)).toThrow();
    expect(parsePositiveYocto(`1${ending}`)).toBeNull();
    expect(parseNonNegativeYocto(`0${ending}`)).toBeNull();
    expect(() => yocto(`1${ending}`)).toThrow();
    expect(testnetAccount(`worker.testnet${ending}`)).toBe(false);
  }
});

it("handles a UTF-8 BOM before a quoted header with embedded line endings", () => {
  const inputCsv = '\ufeff"two\nlines",units\r\nhello,3\r\n';
  expect(parseBoundedCsv(inputCsv)).toMatchObject({ ok: true, value: {
    rawHeader: ["two\nlines", "units"], rawRows: [["hello", "3"]],
  } });
});

it.each(["\r\n", "\r", "\n"])("verifies normalization with embedded %j in the first quoted header", (embedded) => {
  const header = `two${embedded}lines`;
  const request = { serviceType: "csv_normalize" as const,
    inputCsv: `"${header}",units\n hello ,3`,
    options: { columns: ["units"], caseMode: "preserve" as const } };
  const result = runService(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(verifyDeliverable({ request, deliverable: result.value })).toMatchObject({ ok: true, value: { verdict: "pass" } });
});

it("round-trips bounded CSV combinations through execution and independent verification", () => {
  const cells = ["", " plain ", "two\nlines", "two\r\nlines", 'say "hello"', "a,b", "é🙂", "-3", "\t"];
  for (let i = 0; i < cells.length; i++) {
    for (let j = 0; j < cells.length; j++) {
      const inputCsv = Papa.unparse([["label", "other"], [cells[i], cells[j]]], { newline: "\r\n" });
      const request = { serviceType: "csv_normalize" as const, inputCsv,
        options: { columns: ["label"], caseMode: "lowercase" as const } };
      const output = runService(request);
      expect(output.ok, JSON.stringify({ i, j, inputCsv })).toBe(true);
      if (!output.ok) throw new Error(output.message);
      expect(verifyDeliverable({ request, deliverable: output.value }), JSON.stringify({ i, j, inputCsv }))
        .toMatchObject({ ok: true, value: { verdict: "pass" } });
    }
  }
});

it.each([
  ["1000000000000", "0.00001", "-1000000000000"],
  ["-1000000000000", "0.00001", "1000000000000"],
])("retains small contributions after cancellation: %j", (...values) => {
  const request = { serviceType: "csv_summary" as const, inputCsv: `units\n${values.join("\n")}`,
    options: { columns: ["units"] } };
  const output = runService(request);
  expect(output.ok).toBe(true);
  if (!output.ok || output.value.serviceType !== "csv_summary") throw new Error("Expected summary");
  expect(output.value.columns[0].sum).toBeCloseTo(0.00001, 12);
  expect(output.value.columns[0].mean).toBeCloseTo(0.00001 / 3, 12);
  expect(verifyDeliverable({ request, deliverable: output.value })).toMatchObject({ ok: true, value: { verdict: "pass" } });
  const forged = { ...output.value, columns: output.value.columns.map((c) => ({ ...c, sum: 0, mean: 0 })) };
  expect(verifyDeliverable({ request, deliverable: forged })).toMatchObject({ ok: true, value: { verdict: "fail" } });
});

it.each(["1e-324", "-1e-99999", "+0.00001e-99999"])("rejects nonzero numeric underflow instead of reporting zero: %s", (literal) => {
  const request = { serviceType: "csv_summary" as const, inputCsv: `units\n${literal}`,
    options: { columns: ["units"] } };
  expect(runService(request)).toMatchObject({ ok: false, code: "INVALID_NUMBER" });
  expect(verifyDeliverable({ request, deliverable: { serviceType: "csv_summary", format: "json", rowCount: 1,
    columns: [{ name: "units", count: 1, missing: 0, min: 0, max: 0, sum: 0, mean: 0 }] } }))
    .toMatchObject({ ok: false, code: "INVALID_NUMBER" });
});

it("counts the original BOM bytes and preserves embedded BOM content", () => {
  expect(parseBoundedCsv(`\ufeffa\n${"x".repeat(65532)}`)).toMatchObject({ ok: false, code: "INPUT_TOO_LARGE" });
  expect(parseBoundedCsv('a,b\n"\ufeffdata",1')).toMatchObject({ ok: true, value: { rawRows: [["\ufeffdata", "1"]] } });
  expect(parseBoundedCsv('\ufeff"two\nlines",units\r\nhello,3\n')).toMatchObject({ ok: false, code: "INVALID_CSV" });
});

it("matches an exact fixed-point oracle across cancellation permutations", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const large = 100000000000n * BigInt(seed % 9 + 1);
    const smallUnits = BigInt(seed * 37);
    const small = `0.${smallUnits.toString().padStart(8, "0")}`;
    const parts = [large.toString(), small, (-large).toString(), "0.1", "-0.1"];
    const rotated = parts.slice(seed % parts.length).concat(parts.slice(0, seed % parts.length));
    const request = { serviceType: "csv_summary" as const, inputCsv: `units\n${rotated.join("\n")}`,
      options: { columns: ["units"] } };
    const output = runService(request);
    if (!output.ok || output.value.serviceType !== "csv_summary") throw new Error("Expected valid summary");
    expect(output.value.columns[0].sum).toBeCloseTo(Number(smallUnits) / 100000000, 12);
    expect(verifyDeliverable({ request, deliverable: output.value })).toMatchObject({ ok: true, value: { verdict: "pass" } });
  }
});

it("executes and verifies the maximum row/column workload repeatedly", () => {
  const columns = Array.from({ length: 32 }, (_, i) => `n${i}`);
  const inputCsv = [columns.join(","), ...Array(500).fill(Array(32).fill("0.1").join(","))].join("\n");
  const request = { serviceType: "csv_summary" as const, inputCsv, options: { columns } };
  const durations: number[] = [];
  for (let run = 0; run < 20; run++) {
    const start = performance.now();
    const result = runService(request);
    if (!result.ok || result.value.serviceType !== "csv_summary") throw new Error("Expected bounded summary");
    expect(result.value.rowCount).toBe(500);
    expect(result.value.columns).toHaveLength(32);
    expect(result.value.columns.every((c) => c.count === 500 && c.sum === 50 && c.mean === 0.1)).toBe(true);
    expect(verifyDeliverable({ request, deliverable: result.value })).toMatchObject({ ok: true, value: { verdict: "pass" } });
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({ workload: "500 rows x 32 columns, execution + verification", runs: durations.length,
    inputBytes: new TextEncoder().encode(inputCsv).length,
    medianMs: Number(durations[10].toFixed(2)), p95Ms: Number(durations[18].toFixed(2)) }));
});

it.each(["0e-99999", "1e-100", "5e-324"])("retains representable tiny values and exact zero: %s", (literal) => {
  const request = { serviceType: "csv_summary" as const, inputCsv: `units\n${literal}`,
    options: { columns: ["units"] } };
  const output = runService(request);
  expect(output.ok).toBe(true);
  if (!output.ok) throw new Error(output.message);
  expect(verifyDeliverable({ request, deliverable: output.value })).toMatchObject({ ok: true, value: { verdict: "pass" } });
});

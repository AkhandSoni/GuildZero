import { expect, it } from "vitest";
import { inspectSummaryInput, summaryIssueMessage } from "../../lib/summary-preflight";
import { runService, verifyDeliverable } from "../../lib/economy";
it("rejects locale/currency/percent/mixed formats without interpreting their units", () => {
  for (const cell of ['$1,234.50', '1,234.50', '1234,50', '25%', '1.234,50', '£12.50', '1 234.50']) {
    const csv = `amount,units\n"${cell}",3\n12.50,5`;
    const result = inspectSummaryInput(csv, ["amount", "units"]);
    expect(result).toEqual({ ok: true, value: [{ column: "amount", invalidCount: 1, records: [2], code: "INVALID_NUMBER" }] });
    expect(inspectSummaryInput(csv, ["units"])).toEqual({ ok: true, value: [] });
  }
});
it("accepts blanks, signed decimals and scientific notation and preserves unselected content", () => {
  const csv = 'description,units,price\n"quoted, name",-3,-12.50\n"multi\nline",,4\n"1,234.50",+2,1e2';
  expect(inspectSummaryInput(csv, ["units", "price"])).toEqual({ ok: true, value: [] });
  const output = runService({ serviceType: "csv_summary", inputCsv: csv, options: { columns: ["units", "price"] } });
  expect(output.ok).toBe(true);
  if (!output.ok) throw new Error(output.message);
  expect(output.value).toMatchObject({ columns: [{ name: "units", count: 2, missing: 1, sum: -1 }, { name: "price", sum: 91.5 }] });
  const verification = verifyDeliverable({ request: { serviceType: "csv_summary", inputCsv: csv, options: { columns: ["units", "price"] } }, deliverable: output.value });
  expect(verification).toMatchObject({ ok: true, value: { verdict: "pass" } });
});
it("uses CSV record numbers for multiline fields and bounds diagnostics without exposing values", () => {
  const result = inspectSummaryInput('notes,amount\n"line\nbreak",1\ntext,=SECRET()\ntext,@SECRET\ntext,1e99\ntext,1e-999', ["amount"]);
  expect(result).toEqual({ ok: true, value: [{ column: "amount", invalidCount: 4, records: [3, 4, 5], code: "UNSAFE_CSV_CELL" }] });
  if (!result.ok) throw new Error(result.message);
  expect(summaryIssueMessage(result.value[0])).toContain("first 3 of 4");
  expect(summaryIssueMessage(result.value[0])).not.toContain("SECRET");
});
it("keeps malformed or oversized CSV and nonexistent columns rejected", () => {
  for (const csv of ['a,b\n"broken', 'a,b\n1', 'a\n1\r\n2\n3', `a\n${'x'.repeat(65536)}`]) expect(inspectSummaryInput(csv, ["a"]).ok).toBe(false);
  expect(inspectSummaryInput('a\n1', ["missing"])).toMatchObject({ ok: false, code: "INVALID_COLUMNS" });
});

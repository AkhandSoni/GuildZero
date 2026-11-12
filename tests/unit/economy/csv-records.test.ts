import { describe, expect, it } from "vitest";
import { runService, verifyDeliverable } from "../../../lib/economy";
import type { ServiceRequest } from "../../../lib/economy";

function execute(request: ServiceRequest) {
  const result = runService(request);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("CSV record preservation", () => {
  it.each(["", "\n", "\r\n"])("preserves explicit empty records with terminal separator %j", (ending) => {
    const inputCsv = `a,b\n1,2\n,\n3,4${ending}`;
    const request: ServiceRequest = { serviceType: "csv_summary", inputCsv, options: { columns: ["a", "b"] } };
    const output = execute(request);
    expect(output).toMatchObject({ rowCount: 3, columns: [
      { name: "a", count: 2, missing: 1, min: 1, max: 3, sum: 4, mean: 2 },
      { name: "b", count: 2, missing: 1, min: 2, max: 4, sum: 6, mean: 3 },
    ] });
    expect(verifyDeliverable({ request, deliverable: output })).toMatchObject({ ok: true, value: { verdict: "pass" } });
    const forged = execute({ ...request, inputCsv: "a,b\n1,2\n3,4" });
    expect(verifyDeliverable({ request, deliverable: forged })).toMatchObject({ ok: true, value: { verdict: "fail" } });
  });

  it("normalizes without deleting empty records and rejects a deleted-row deliverable", () => {
    const request: ServiceRequest = { serviceType: "csv_normalize", inputCsv: "a,b\n X ,Y\n,\n Z ,W", options: { columns: ["a"], caseMode: "lowercase" } };
    const output = execute(request);
    expect(output).toMatchObject({ rowCount: 3, csv: "a,b\nx,Y\n,\nz,W" });
    expect(verifyDeliverable({ request, deliverable: output })).toMatchObject({ ok: true, value: { verdict: "pass" } });
    expect(verifyDeliverable({ request, deliverable: execute({ ...request, inputCsv: "a,b\n X ,Y\n Z ,W" }) })).toMatchObject({ ok: true, value: { verdict: "fail" } });
  });

  it.each(["a\n\"\"", "a\n\n", "a\n\"\"\n"])("retains a one-column empty record: %j", (inputCsv) => {
    const request: ServiceRequest = { serviceType: "csv_normalize", inputCsv, options: { columns: ["a"], caseMode: "preserve" } };
    const output = execute(request);
    expect(output).toMatchObject({ csv: "a\n\"\"", rowCount: 1 });
    expect(verifyDeliverable({ request, deliverable: output })).toMatchObject({ ok: true, value: { verdict: "pass" } });
    expect(execute({ serviceType: "csv_summary", inputCsv, options: { columns: ["a"] } })).toMatchObject({ rowCount: 1, columns: [{ count: 0, missing: 1, min: null, max: null, sum: 0, mean: null }] });
  });

  it("counts all-empty records toward the row cap and rejects invalid-width blanks", () => {
    expect(runService({ serviceType: "csv_summary", inputCsv: `a,b\n${Array(501).fill(",").join("\n")}`, options: { columns: ["a"] } })).toMatchObject({ ok: false, code: "INVALID_CSV" });
    expect(runService({ serviceType: "csv_summary", inputCsv: "a,b\n1,2\n\n3,4", options: { columns: ["a"] } })).toMatchObject({ ok: false, code: "INVALID_CSV" });
  });
});

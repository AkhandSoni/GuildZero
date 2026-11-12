// Economy package unit tests
import { describe, it, expect } from "vitest";
import { estimateCost, makeBid, runService, verifyDeliverable } from "../../../lib/economy";
import type { CostInput, BidInput, NormalizeRequest } from "../../../lib/economy/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturesDir = resolve(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8").trimEnd();
}

describe("CSV services", () => {
  it("normalizes CSV according to fixture", () => {
    const inputCsv = loadFixture("sales.csv");
    const result = runService({
      serviceType: "csv_normalize",
      inputCsv,
      options: { columns: ["product", "region", "units", "price"], caseMode: "lowercase" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const out = result.value;
    if (out.serviceType !== "csv_normalize") throw new Error("unexpected");
    const expectedCsv = loadFixture("normalized.expected.csv");
    expect(out.csv).toBe(expectedCsv);
    expect(out.rowCount).toBe(4);
  });

  it("summarizes CSV according to fixture", () => {
    const inputCsv = loadFixture("sales.csv");
    const result = runService({
      serviceType: "csv_summary",
      inputCsv,
      options: { columns: ["units", "price"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const out = result.value;
    if (out.serviceType !== "csv_summary") throw new Error("unexpected");
    const expected = JSON.parse(loadFixture("summary.expected.json"));
    expect(out.rowCount).toBe(expected.rowCount);
    expect(out.columns).toEqual(expected.columns);
  });
});

describe("Cost estimation and bidding", () => {
  it("estimates cost and makes a valid bid", () => {
    const costInput: CostInput = {
      workload: { serviceType: "csv_normalize", rowCount: 4, columnCount: 4, complexityBps: 0, riskBps: 0 },
      baseCostYocto: "1000000000000000000000",
      perRowCostYocto: "500000000000000000000",
      perCellCostYocto: "10000000000000000000",
    };
    const est = estimateCost(costInput);
    expect(est.estimatedCostYocto).toBeDefined(); // just ensure no throw
    const bidInput: BidInput = {
      agent: {
        id: "clean-sprint",
        name: "Clean Sprint",
        role: "cleaning",
        capabilities: ["csv_normalize"],
        strategy: "aggressive",
        reservePriceYocto: "100000000000000000000000",
        capacity: 2,
      },
      workload: costInput.workload,
      costModel: costInput,
      activeAssignments: 0,
      budgetYocto: "5000000000000000000000000",
      nowMs: 0,
      deadlineAtMs: 1000000,
      estimatedDurationMs: 50000,
      bidId: "b1",
    };
    const bid = makeBid(bidInput);
    expect(bid.ok).toBe(true);
    if (bid.ok) {
      expect(bid.value.decision).toBe("offer");
    }
  });
});

describe("Verification", () => {
  it("verifies a correct normalization deliverable", () => {
    const request: NormalizeRequest = {
      serviceType: "csv_normalize",
      inputCsv: loadFixture("sales.csv"),
      options: { columns: ["product", "region", "units", "price"], caseMode: "lowercase" },
    };
    const result = runService(request);
    expect(result.ok).toBe(true);
    const verification = verifyDeliverable({ request, deliverable: result.ok ? result.value : null });
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.value.verdict).toBe("pass");
    }
  });
});

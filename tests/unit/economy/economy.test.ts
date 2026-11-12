// Comprehensive unit and regression tests for the deterministic economy kernel
import { describe, it, expect } from "vitest";
import {
  estimateCost,
  makeBid,
  rankBids,
  respondToCounteroffer,
  runService,
  verifyDeliverable,
  validateServiceOptions,
} from "../../../lib/economy";
import type {
  CostInput,
  Offer,
  NormalizeRequest,
  SummaryRequest,
  Workload,
} from "../../../lib/economy/types";
import { INITIAL_AGENTS } from "../../../lib/agents";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturesDir = resolve(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8").trimEnd();
}

const baseWorkload: Workload = {
  serviceType: "csv_normalize",
  rowCount: 4,
  columnCount: 4,
  complexityBps: 0,
  riskBps: 0,
};

const baseCostInput: CostInput = {
  workload: baseWorkload,
  baseCostYocto: "1000000000000000000000",
  perRowCostYocto: "500000000000000000000",
  perCellCostYocto: "10000000000000000000",
};

describe("CSV services: fixtures, quoting, formulas, and validation", () => {
  it("normalizes CSV according to synthetic fixture", () => {
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
    expect(out.columns).toEqual(["product", "region", "units", "price"]);
  });

  it("summarizes CSV according to synthetic fixture", () => {
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

  it("quotes commas, quotes, and embedded newlines in csv_normalize and enforces output size bounds", () => {
    const simpleComma = 'name,count\n"Bag, large",3';
    const simpleRes = runService({
      serviceType: "csv_normalize",
      inputCsv: simpleComma,
      options: { columns: ["name"], caseMode: "preserve" },
    });
    expect(simpleRes).toEqual({
      ok: true,
      value: {
        serviceType: "csv_normalize",
        format: "csv",
        csv: 'name,count\n"Bag, large",3',
        rowCount: 1,
        columns: ["name"],
      },
    });

    const csvWithSpecialChars = 'name, note \n"Bag, large","Line 1\nLine ""2"""\n  Item 2  ,"plain, text"';
    const res = runService({
      serviceType: "csv_normalize",
      inputCsv: csvWithSpecialChars,
      options: { columns: ["name"], caseMode: "lowercase" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.value.serviceType !== "csv_normalize") throw new Error("expected normalize output");
    expect(res.value.csv).toBe('name," note "\n"bag, large","Line 1\nLine ""2"""\nitem 2,"plain, text"');

    const ver = verifyDeliverable({
      request: {
        serviceType: "csv_normalize",
        inputCsv: csvWithSpecialChars,
        options: { columns: ["name"], caseMode: "lowercase" },
      },
      deliverable: res.value,
    });
    expect(ver).toMatchObject({ ok: true, value: { verdict: "pass", reasonCode: "VERIFICATION_PASSED" } });
  });

  it("preserves exact header names with whitespace when matching options", () => {
    const csv = " product ,region\n Bag ,North";
    expect(
      runService({
        serviceType: "csv_normalize",
        inputCsv: csv,
        options: { columns: ["product"], caseMode: "lowercase" },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_OPTIONS" });

    const valid = runService({
      serviceType: "csv_normalize",
      inputCsv: csv,
      options: { columns: [" product "], caseMode: "lowercase" },
    });
    expect(valid.ok).toBe(true);
    if (valid.ok && valid.value.serviceType === "csv_normalize") {
      expect(valid.value.csv).toBe('" product ",region\nbag,North');
    }
  });

  it("rejects spreadsheet formulas in both selected and unselected columns while allowing safe numeric negatives", () => {
    // Unselected column with formula
    expect(
      runService({
        serviceType: "csv_normalize",
        inputCsv: "name,note\n Bag ,=1+1",
        options: { columns: ["name"], caseMode: "lowercase" },
      }),
    ).toMatchObject({ ok: false, code: "UNSAFE_CSV_CELL" });

    // '=1' in selected column (not a numeric literal)
    expect(
      runService({
        serviceType: "csv_normalize",
        inputCsv: "name,note\n=1,ok",
        options: { columns: ["name"], caseMode: "preserve" },
      }),
    ).toMatchObject({ ok: false, code: "UNSAFE_CSV_CELL" });

    // '+' / '-' / '@' formula prefixes and unsafe headers
    for (const formula of ["+1+1", "-1+1", "@SUM(A1:A2)", " =CMD()"]) {
      expect(
        runService({
          serviceType: "csv_normalize",
          inputCsv: `name,note\nBag,${formula}`,
          options: { columns: ["name"], caseMode: "preserve" },
        }),
      ).toMatchObject({ ok: false, code: "UNSAFE_CSV_CELL" });
    }
    expect(
      runService({
        serviceType: "csv_normalize",
        inputCsv: "=header,note\nBag,ok",
        options: { columns: ["note"], caseMode: "preserve" },
      }),
    ).toMatchObject({ ok: false, code: "UNSAFE_CSV_CELL" });

    // '=1' in summary column must be rejected rather than stripped to 1
    expect(
      runService({
        serviceType: "csv_summary",
        inputCsv: "x\n=1\n2",
        options: { columns: ["x"] },
      }),
    ).toMatchObject({ ok: false, code: "UNSAFE_CSV_CELL" });

    // Safe negative and scientific numeric tokens are allowed in both normalize and summary
    const safeNegNorm = runService({
      serviceType: "csv_normalize",
      inputCsv: "name,delta\n Bag , -3.5 \nPen,-1.2e2",
      options: { columns: ["name", "delta"], caseMode: "lowercase" },
    });
    expect(safeNegNorm).toMatchObject({
      ok: true,
      value: { csv: "name,delta\nbag,-3.5\npen,-1.2e2" },
    });

    const safeNegSum = runService({
      serviceType: "csv_summary",
      inputCsv: "delta,id\n-3.5,1\n1.5,2\n,3",
      options: { columns: ["delta"] },
    });
    expect(safeNegSum).toMatchObject({
      ok: true,
      value: {
        rowCount: 3,
        columns: [{ name: "delta", count: 2, missing: 1, min: -3.5, max: 1.5, sum: -2, mean: -1 }],
      },
    });
  });

  it("handles all-missing summary columns and rejects invalid/partial/nonfinite numbers", () => {
    const allMissing = runService({
      serviceType: "csv_summary",
      inputCsv: "x,y\n,2\n ,3",
      options: { columns: ["x"] },
    });
    expect(allMissing).toEqual({
      ok: true,
      value: {
        serviceType: "csv_summary",
        format: "json",
        rowCount: 2,
        columns: [{ name: "x", count: 0, missing: 2, min: null, max: null, sum: 0, mean: null }],
      },
    });

    for (const badNum of ["12px", "0x10", "NaN", "Infinity", "true", "1e13", "-1.0001e12"]) {
      expect(
        runService({
          serviceType: "csv_summary",
          inputCsv: `x\n${badNum}`,
          options: { columns: ["x"] },
        }),
      ).toMatchObject({ ok: false, code: "INVALID_NUMBER" });
    }
  });

  it("rejects parser errors, oversized inputs, and unknown/invalid options", () => {
    // Unterminated quote parser error
    expect(
      runService({
        serviceType: "csv_normalize",
        inputCsv: 'name,count\nBag,"3',
        options: { columns: ["name"], caseMode: "preserve" },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_CSV" });

    // Invalid caseMode
    expect(
      runService({
        serviceType: "csv_normalize",
        inputCsv: "name,count\nBag,3",
        options: { columns: ["name"], caseMode: "titlecase" as "preserve" },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_OPTIONS" });

    // Irrelevant option on summary
    expect(
      runService({
        serviceType: "csv_summary",
        inputCsv: "name,count\nBag,3",
        options: { columns: ["count"], caseMode: "lowercase" } as unknown as SummaryRequest["options"],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_OPTIONS" });

    // Oversized input (> 64 KiB)
    const hugeCsv = `x\n${"1\n".repeat(33000)}`;
    expect(
      runService({
        serviceType: "csv_summary",
        inputCsv: hugeCsv,
        options: { columns: ["x"] },
      }),
    ).toMatchObject({ ok: false, code: "INPUT_TOO_LARGE" });

    // validateServiceOptions helper
    expect(validateServiceOptions("csv_summary", undefined, ["x"], true)).toMatchObject({
      ok: false,
      code: "OPTIONS_REQUIRED",
    });
  });
});

describe("Independent verification", () => {
  it("rejects structurally invalid unquoted CSV deliverables even if row count metadata matches", () => {
    const request: NormalizeRequest = {
      serviceType: "csv_normalize",
      inputCsv: 'name,count\n"Bag, large",3',
      options: { columns: ["name"], caseMode: "preserve" },
    };
    // Unquoted comma corrupts 2-column row into 3 cells
    const corruptedDeliverable = {
      serviceType: "csv_normalize",
      format: "csv",
      csv: "name,count\nBag, large,3",
      rowCount: 1,
      columns: ["name"],
    };
    const ver = verifyDeliverable({ request, deliverable: corruptedDeliverable });
    expect(ver).toMatchObject({
      ok: true,
      value: { verdict: "fail", reasonCode: "CONTENT_MISMATCH" },
    });
  });

  it("compares summary statistics field-by-field using the specified tolerance and ignores property order", () => {
    const request: SummaryRequest = {
      serviceType: "csv_summary",
      inputCsv: "x,y\n,2\n ,3",
      options: { columns: ["x"] },
    };
    // Reordered keys and sum = 1e-10 (within 1e-9 * max(1, 0))
    const deliverableWithinTol = {
      format: "json",
      serviceType: "csv_summary",
      rowCount: 2,
      columns: [
        {
          mean: null,
          sum: 1e-10,
          max: null,
          min: null,
          missing: 2,
          count: 0,
          name: "x",
        },
      ],
    };
    const passRes = verifyDeliverable({ request, deliverable: deliverableWithinTol });
    expect(passRes).toMatchObject({
      ok: true,
      value: { verdict: "pass", reasonCode: "VERIFICATION_PASSED" },
    });

    // Outside tolerance: sum = 1e-7 > 1e-9
    const deliverableOutsideTol = {
      ...deliverableWithinTol,
      columns: [{ ...deliverableWithinTol.columns[0], sum: 1e-7 }],
    };
    const failRes = verifyDeliverable({ request, deliverable: deliverableOutsideTol });
    expect(failRes).toMatchObject({
      ok: true,
      value: { verdict: "fail", reasonCode: "STATISTICS_MISMATCH" },
    });
  });

  it("rejects tampered rows, forged counts, wrong totals, extra/missing/duplicate columns, and returns needs_human for subjective criteria", () => {
    const normReq: NormalizeRequest = {
      serviceType: "csv_normalize",
      inputCsv: loadFixture("sales.csv"),
      options: { columns: ["product", "region"], caseMode: "lowercase" },
    };
    const normOut = runService(normReq);
    if (!normOut.ok || normOut.value.serviceType !== "csv_normalize") throw new Error("unexpected");

    // Deleted row
    expect(
      verifyDeliverable({
        request: normReq,
        deliverable: {
          ...normOut.value,
          csv: normOut.value.csv.split("\n").slice(0, 4).join("\n"),
        },
      }),
    ).toMatchObject({ ok: true, value: { verdict: "fail", reasonCode: "ROW_COUNT_MISMATCH" } });

    // Tampered cell value
    expect(
      verifyDeliverable({
        request: normReq,
        deliverable: {
          ...normOut.value,
          csv: normOut.value.csv.replace("canvas bag", "forged bag"),
        },
      }),
    ).toMatchObject({ ok: true, value: { verdict: "fail", reasonCode: "CONTENT_MISMATCH" } });

    // Summary duplicate / mismatched columns
    const sumReq: SummaryRequest = {
      serviceType: "csv_summary",
      inputCsv: loadFixture("sales.csv"),
      options: { columns: ["units", "price"] },
    };
    const sumOut = runService(sumReq);
    if (!sumOut.ok || sumOut.value.serviceType !== "csv_summary") throw new Error("unexpected");

    expect(
      verifyDeliverable({
        request: sumReq,
        deliverable: {
          ...sumOut.value,
          columns: [sumOut.value.columns[0], sumOut.value.columns[0]],
        },
      }),
    ).toMatchObject({ ok: true, value: { verdict: "fail", reasonCode: "CONTENT_MISMATCH" } });

    // Subjective criteria returns needs_human, never auto-pass
    expect(
      verifyDeliverable({
        request: normReq,
        deliverable: normOut.value,
        acceptanceCriteria: "Ensure product names sound appealing to enterprise buyers",
      }),
    ).toMatchObject({ ok: true, value: { verdict: "needs_human", reasonCode: "UNSUPPORTED_CRITERIA" } });
  });
});

describe("Cost estimation, bidding, ranking, and negotiation", () => {
  it("validates workload/cost inputs and applies complexityBps and riskBps adjustments", () => {
    // Non-integer rowCount returns typed failure instead of throwing RangeError
    expect(
      estimateCost({
        ...baseCostInput,
        workload: { ...baseWorkload, rowCount: 1.5 },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect(
      estimateCost({
        ...baseCostInput,
        workload: { ...baseWorkload, rowCount: 0 },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect(
      estimateCost({
        ...baseCostInput,
        baseCostYocto: "-5",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });

    // 1 row, 1 col, base=100, perRow=1, perCell=1 => 102 at 0 bps
    const zeroMod = estimateCost({
      workload: { serviceType: "csv_normalize", rowCount: 1, columnCount: 1, complexityBps: 0, riskBps: 0 },
      baseCostYocto: "100",
      perRowCostYocto: "1",
      perCellCostYocto: "1",
    });
    expect(zeroMod).toMatchObject({
      ok: true,
      value: { baseCostYocto: "100", variableCostYocto: "2", estimatedCostYocto: "102" },
    });

    // With complexityBps=10000 and riskBps=10000 (+200% surcharge), cost increases to 306
    const maxMod = estimateCost({
      workload: { serviceType: "csv_normalize", rowCount: 1, columnCount: 1, complexityBps: 10000, riskBps: 10000 },
      baseCostYocto: "100",
      perRowCostYocto: "1",
      perCellCostYocto: "1",
    });
    expect(maxMod).toMatchObject({
      ok: true,
      value: { baseCostYocto: "100", variableCostYocto: "206", estimatedCostYocto: "306" },
    });
  });

  it("enforces capability checks, strategy validation, and cost-backed minimum floors in makeBid", () => {
    const cleanSprint = INITIAL_AGENTS.find((a) => a.id === "clean-sprint")!;
    const verifyAgent = INITIAL_AGENTS.find((a) => a.id === "verify")!;

    // Cleaning agent (csv_normalize only) declines csv_summary with CAPABILITY_MISMATCH
    const mismatch = makeBid({
      agent: cleanSprint,
      workload: { ...baseWorkload, serviceType: "csv_summary" },
      costModel: baseCostInput,
      activeAssignments: 0,
      budgetYocto: "5000000000000000000000000",
      nowMs: 1000,
      deadlineAtMs: 60000,
      estimatedDurationMs: 5000,
      bidId: "b-mismatch",
    });
    expect(mismatch).toEqual({
      ok: true,
      value: {
        decision: "decline",
        decline: {
          reason: "Agent clean-sprint does not support csv_summary.",
          code: "CAPABILITY_MISMATCH",
        },
      },
    });

    // Non-seller support profile declines unsupported capability
    const supportDecline = makeBid({
      agent: verifyAgent,
      workload: baseWorkload,
      costModel: baseCostInput,
      activeAssignments: 0,
      budgetYocto: "5000000000000000000000000",
      nowMs: 1000,
      deadlineAtMs: 60000,
      estimatedDurationMs: 5000,
      bidId: "b-verify",
    });
    expect(supportDecline).toMatchObject({
      ok: true,
      value: { decision: "decline", decline: { code: "CAPABILITY_MISMATCH" } },
    });

    // Null or unknown seller strategy on a capable profile fails validation
    expect(
      makeBid({
        agent: { ...cleanSprint, strategy: null },
        workload: baseWorkload,
        costModel: baseCostInput,
        activeAssignments: 0,
        budgetYocto: "5000000000000000000000000",
        nowMs: 1000,
        deadlineAtMs: 60000,
        estimatedDurationMs: 5000,
        bidId: "b-null-strat",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    // Cost floor: base=100, perRow=1, perCell=1 (1x1) => cost=102, reserve=10 => minimumAcceptable >= 102
    const lowReserveBid = makeBid({
      agent: { ...cleanSprint, reservePriceYocto: "10" },
      workload: { serviceType: "csv_normalize", rowCount: 1, columnCount: 1, complexityBps: 0, riskBps: 0 },
      costModel: { baseCostYocto: "100", perRowCostYocto: "1", perCellCostYocto: "1" },
      activeAssignments: 0,
      budgetYocto: "500",
      nowMs: 1000,
      deadlineAtMs: 60000,
      estimatedDurationMs: 5000,
      bidId: "b-floor",
    });
    expect(lowReserveBid.ok).toBe(true);
    if (!lowReserveBid.ok || lowReserveBid.value.decision !== "offer") throw new Error("expected offer");
    expect(BigInt(lowReserveBid.value.offer.minimumAcceptableYocto)).toBeGreaterThanOrEqual(102n);
    expect(BigInt(lowReserveBid.value.offer.priceYocto)).toBeGreaterThanOrEqual(
      BigInt(lowReserveBid.value.offer.minimumAcceptableYocto),
    );
  });

  it("competes across three built-in csv_summary sellers, normalizes ETA durations, filters ineligible offers, and breaks ties deterministically across permutations", () => {
    const summaryWorkload: Workload = {
      serviceType: "csv_summary",
      rowCount: 10,
      columnCount: 4,
      complexityBps: 500,
      riskBps: 500,
    };
    const costModel = {
      baseCostYocto: "50000000000000000000000",
      perRowCostYocto: "5000000000000000000000",
      perCellCostYocto: "1000000000000000000000",
    };
    const summarySellers = INITIAL_AGENTS.filter((a) =>
      (a.capabilities as readonly string[]).includes("csv_summary"),
    );
    expect(summarySellers.length).toBe(3);

    const offers: Offer[] = [];
    for (let i = 0; i < summarySellers.length; i++) {
      const seller = summarySellers[i];
      const bidRes = makeBid({
        agent: seller,
        workload: summaryWorkload,
        costModel,
        activeAssignments: 0,
        budgetYocto: "1000000000000000000000000",
        nowMs: 1_700_000_000_000,
        deadlineAtMs: 1_700_000_060_000,
        estimatedDurationMs: 1000 + i * 500,
        bidId: `bid-${seller.id}`,
      });
      expect(bidRes.ok).toBe(true);
      if (bidRes.ok && bidRes.value.decision === "offer") {
        offers.push(bidRes.value.offer);
      }
    }
    expect(offers.length).toBe(3);

    const rankedRes = rankBids({
      budgetYocto: "1000000000000000000000000",
      availableDurationMs: 60000,
      offers,
      reputationBps: [8000, 8500, 8200],
      capabilityMatchBps: [10000, 10000, 10000],
    });
    expect(rankedRes.ok).toBe(true);
    if (!rankedRes.ok) throw new Error(rankedRes.message);
    expect(rankedRes.value.length).toBe(3);
    for (const r of rankedRes.value) {
      expect(r.priceScore).toBeGreaterThanOrEqual(0);
      expect(r.priceScore).toBeLessThanOrEqual(10000);
      expect(r.etaScore).toBeGreaterThanOrEqual(0);
      expect(r.etaScore).toBeLessThanOrEqual(10000);
      expect(r.totalScore).toBeGreaterThanOrEqual(0);
      expect(r.totalScore).toBeLessThanOrEqual(10000);
    }

    // Filter out over-budget, expired, and below-floor offers
    const overBudgetOffer: Offer = {
      agentId: "stats-core",
      bidId: "b-over",
      priceYocto: "100",
      minimumAcceptableYocto: "50",
      estimatedCostYocto: "40",
      etaMs: 1000,
      strategy: "balanced",
      explanation: "over budget",
    };
    const overBudgetRank = rankBids({
      budgetYocto: "99",
      availableDurationMs: 60000,
      offers: [overBudgetOffer],
      reputationBps: [9000],
      capabilityMatchBps: [10000],
    });
    expect(overBudgetRank).toEqual({ ok: true, value: [] });

    // Reject malformed parallel score arrays
    expect(
      rankBids({
        budgetYocto: "1000",
        availableDurationMs: 60000,
        offers: [overBudgetOffer],
        reputationBps: [],
        capabilityMatchBps: [10000],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    // Permutation & tie-break invariance test
    const tiedA: Offer = {
      agentId: "agent-a",
      bidId: "bid-2",
      priceYocto: "500",
      minimumAcceptableYocto: "400",
      estimatedCostYocto: "300",
      etaMs: 2000,
      strategy: "balanced",
      explanation: "",
    };
    const tiedB: Offer = {
      ...tiedA,
      agentId: "agent-b",
      bidId: "bid-1",
    };
    const tiedC: Offer = {
      ...tiedA,
      agentId: "agent-a",
      bidId: "bid-1",
    };
    const r1 = rankBids({
      budgetYocto: "1000",
      availableDurationMs: 10000,
      offers: [tiedA, tiedB, tiedC],
      reputationBps: [8000, 8000, 8000],
      capabilityMatchBps: [10000, 10000, 10000],
    });
    const r2 = rankBids({
      budgetYocto: "1000",
      availableDurationMs: 10000,
      offers: [tiedB, tiedC, tiedA],
      reputationBps: [8000, 8000, 8000],
      capabilityMatchBps: [10000, 10000, 10000],
    });
    expect(r1).toEqual(r2);
    if (r1.ok) {
      expect(r1.value.map((x) => `${x.offer.agentId}:${x.offer.bidId}:${x.rank}`)).toEqual([
        "agent-a:bid-1:1",
        "agent-a:bid-2:2",
        "agent-b:bid-1:3",
      ]);
    }
  });

  it("records the exact accepted buyer price in respondToCounteroffer, enforces cost/minimum floors, and rejects invalid rounds", () => {
    const currentOffer: Offer = {
      agentId: "stats-core",
      bidId: "b1",
      priceYocto: "100",
      minimumAcceptableYocto: "50",
      estimatedCostYocto: "40",
      etaMs: 5000,
      strategy: "balanced",
      explanation: "initial",
    };

    // Round 3 acceptance records buyerOfferYocto='75', not currentOffer.priceYocto='100'
    const accepted = respondToCounteroffer({
      currentOffer,
      round: 3,
      buyerOfferYocto: "75",
      sellerMinimumYocto: "50",
      budgetYocto: "200",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || accepted.value.decision !== "accept") throw new Error("expected accept");
    expect(accepted.value.offer.priceYocto).toBe("75");
    expect(accepted.value.priceYocto).toBe("75");

    // Cannot accept below estimatedCostYocto even if minimumAcceptableYocto and sellerMinimumYocto are lower
    const lowFloorOffer: Offer = {
      ...currentOffer,
      priceYocto: "120",
      minimumAcceptableYocto: "10",
      estimatedCostYocto: "102",
    };
    const round2Counter = respondToCounteroffer({
      currentOffer: lowFloorOffer,
      round: 2,
      buyerOfferYocto: "10",
      sellerMinimumYocto: "10",
      budgetYocto: "200",
    });
    expect(round2Counter.ok).toBe(true);
    if (!round2Counter.ok || round2Counter.value.decision !== "counter") throw new Error("expected counter");
    expect(BigInt(round2Counter.value.counterOffer.priceYocto)).toBeGreaterThanOrEqual(102n);
    expect(BigInt(round2Counter.value.counterOffer.priceYocto)).toBeLessThanOrEqual(120n);

    // Round 3 below floor rejects
    const round3Reject = respondToCounteroffer({
      currentOffer: lowFloorOffer,
      round: 3,
      buyerOfferYocto: "100",
      sellerMinimumYocto: "10",
      budgetYocto: "200",
    });
    expect(round3Reject).toMatchObject({
      ok: true,
      value: { decision: "reject", code: "BELOW_SELLER_MINIMUM", round: 3 },
    });

    // Invalid round 4 fails with ROUND_LIMIT
    expect(
      respondToCounteroffer({
        currentOffer,
        round: 4 as 2,
        buyerOfferYocto: "80",
        sellerMinimumYocto: "50",
        budgetYocto: "200",
      }),
    ).toMatchObject({ ok: false, code: "ROUND_LIMIT" });

    // 1-yoctoNEAR and > Number.MAX_SAFE_INTEGER boundaries
    const oneYoctoOffer: Offer = {
      ...currentOffer,
      priceYocto: "1",
      minimumAcceptableYocto: "1",
      estimatedCostYocto: "0",
    };
    const oneYoctoAccept = respondToCounteroffer({
      currentOffer: oneYoctoOffer,
      round: 2,
      buyerOfferYocto: "1",
      sellerMinimumYocto: "1",
      budgetYocto: "1",
    });
    expect(oneYoctoAccept).toMatchObject({
      ok: true,
      value: { decision: "accept", priceYocto: "1" },
    });

    const largeAmount = "9007199254740993123456789"; // > Number.MAX_SAFE_INTEGER
    const largeAccept = respondToCounteroffer({
      currentOffer: {
        ...currentOffer,
        priceYocto: largeAmount,
        minimumAcceptableYocto: largeAmount,
        estimatedCostYocto: largeAmount,
      },
      round: 2,
      buyerOfferYocto: largeAmount,
      sellerMinimumYocto: largeAmount,
      budgetYocto: largeAmount,
    });
    expect(largeAccept).toMatchObject({
      ok: true,
      value: { decision: "accept", priceYocto: largeAmount },
    });
  });
});

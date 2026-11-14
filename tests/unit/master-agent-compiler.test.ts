import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  BENCHMARK_FIXTURES,
  BENCHMARK_MANIFEST_SHA256,
  MASTER_AGENT_SCHEMA_VERSION,
  buildCaseDatasets,
  compileMasterAgentPlan,
  inspectDatasetMetadata,
  scoreBenchmarkTrial,
  sha256Hex,
  type MasterAgentPlanV1,
} from "../../lib/master-agent";
import { nearToYocto } from "../../lib/money";

describe("Master Agent deterministic compiler & benchmark scorer", () => {
  it("inspects dataset metadata accurately for F1..F5", () => {
    const f1Meta = inspectDatasetMetadata("d1", BENCHMARK_FIXTURES.F1.name, BENCHMARK_FIXTURES.F1.csv);
    expect(f1Meta.headers).toEqual(["order_id", "product", "region", "units", "revenue"]);
    expect(f1Meta.numericReadyColumns).toEqual(["units", "revenue"]);
    expect(f1Meta.uniqueKeyCandidateColumns).toContain("order_id");

    const f2Meta = inspectDatasetMetadata("d1", BENCHMARK_FIXTURES.F2.name, BENCHMARK_FIXTURES.F2.csv);
    expect(f2Meta.hasLeadingOrTrailingWhitespaceColumns).toEqual(["product", "region"]);

    const f5Meta = inspectDatasetMetadata("d1", BENCHMARK_FIXTURES.F5.name, BENCHMARK_FIXTURES.F5.csv);
    expect(f5Meta.numericReadyColumns).toEqual([]);
    expect(f5Meta.nonNumericColumns).toContain("revenue");
  });

  it("compiles all 5 service templates and strips inactive options only after validation", () => {
    const now = 1_760_000_000_000;
    const deadlineAt = now + 86400000;
    const f1Datasets = [
      {
        ref: "d1",
        name: "sales.csv",
        csv: BENCHMARK_FIXTURES.F1.csv,
        sha256: sha256Hex(BENCHMARK_FIXTURES.F1.csv),
      },
    ];

    const multiStepPlan: MasterAgentPlanV1 = {
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: "execute",
      summary: "Audit product and units, then group by product to summarize units and revenue.",
      questions: [],
      reasonCodes: [],
      proposedTotalBudgetYocto: nearToYocto("1"),
      steps: [
        {
          stepId: "s1",
          title: "Quality audit of product and units",
          serviceType: "csv_validate",
          datasetRef: "d1",
          comparisonDatasetRef: null,
          options: {
            columns: ["product", "units"],
            caseMode: null,
            numericColumns: ["units"],
            keyColumn: null,
            groupBy: null,
          },
          maxBudgetYocto: nearToYocto("0.5"),
          cleanBeforeProcessing: false,
          requiresHumanReview: false,
          acceptanceCriteria: "Audit missing, duplicate, whitespace and numeric format on units.",
        },
        {
          stepId: "s2",
          title: "Grouped numeric report by product",
          serviceType: "csv_report",
          datasetRef: "d1",
          comparisonDatasetRef: null,
          options: {
            columns: ["units", "revenue"],
            caseMode: null,
            numericColumns: null,
            keyColumn: null,
            groupBy: "product",
          },
          maxBudgetYocto: nearToYocto("0.5"),
          cleanBeforeProcessing: false,
          requiresHumanReview: false,
          acceptanceCriteria: "Compute exact grouped sums and counts for units and revenue by product.",
        },
      ],
    };

    const compiled = compileMasterAgentPlan(multiStepPlan, {
      datasets: f1Datasets,
      maxBudgetYocto: nearToYocto("1"),
      deadlineAt,
      requiresHumanReview: true,
      now,
    });

    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.value.compiledSteps).toHaveLength(2);
      expect(compiled.value.compiledSteps[0].serviceOptions).toEqual({
        columns: ["product", "units"],
        numericColumns: ["units"],
      });
      expect(compiled.value.compiledSteps[1].serviceOptions).toEqual({
        columns: ["units", "revenue"],
        groupBy: "product",
      });
      // Preserves user requiresHumanReview=true override even though step had false
      expect(compiled.value.compiledSteps[0].missionInput.requiresHumanReview).toBe(true);
    }
  });

  it("rejects non-null inactive options, invalid numeric columns (F5), and budget mismatches", () => {
    const now = 1_760_000_000_000;
    const deadlineAt = now + 86400000;
    const f5Datasets = [
      {
        ref: "d1",
        name: "invalid-number.csv",
        csv: BENCHMARK_FIXTURES.F5.csv,
        sha256: sha256Hex(BENCHMARK_FIXTURES.F5.csv),
      },
    ];

    const invalidNumericPlan: MasterAgentPlanV1 = {
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: "execute",
      summary: "Summarize revenue.",
      questions: [],
      reasonCodes: [],
      proposedTotalBudgetYocto: nearToYocto("0.5"),
      steps: [
        {
          stepId: "s1",
          title: "Summary of revenue",
          serviceType: "csv_summary",
          datasetRef: "d1",
          comparisonDatasetRef: null,
          options: {
            columns: ["revenue"],
            caseMode: null,
            numericColumns: null,
            keyColumn: null,
            groupBy: null,
          },
          maxBudgetYocto: nearToYocto("0.5"),
          cleanBeforeProcessing: false,
          requiresHumanReview: false,
          acceptanceCriteria: "Summarize revenue.",
        },
      ],
    };

    const resF5 = compileMasterAgentPlan(invalidNumericPlan, {
      datasets: f5Datasets,
      maxBudgetYocto: nearToYocto("0.5"),
      deadlineAt,
      requiresHumanReview: false,
      now,
    });
    expect(resF5.ok).toBe(false);
    if (!resF5.ok) {
      expect(resF5.code).toBe("INVALID_NUMBER");
    }

    // Rejects over-budget plan
    const overBudget = compileMasterAgentPlan(
      {
        ...invalidNumericPlan,
        proposedTotalBudgetYocto: nearToYocto("0.8"),
        steps: [{ ...invalidNumericPlan.steps[0], maxBudgetYocto: nearToYocto("0.8") }],
      },
      {
        datasets: [
          {
            ref: "d1",
            name: "sales.csv",
            csv: BENCHMARK_FIXTURES.F1.csv,
            sha256: sha256Hex(BENCHMARK_FIXTURES.F1.csv),
          },
        ],
        maxBudgetYocto: nearToYocto("0.5"),
        deadlineAt,
        requiresHumanReview: false,
        now,
      },
    );
    expect(overBudget.ok).toBe(false);
    if (!overBudget.ok) {
      expect(overBudget.code).toBe("BUDGET_TOO_LOW");
    }

    // Rejects mismatched step budget sum
    const sumMismatch = compileMasterAgentPlan(
      {
        ...invalidNumericPlan,
        proposedTotalBudgetYocto: nearToYocto("0.5"),
        steps: [{ ...invalidNumericPlan.steps[0], maxBudgetYocto: nearToYocto("0.4") }],
      },
      {
        datasets: [
          {
            ref: "d1",
            name: "sales.csv",
            csv: BENCHMARK_FIXTURES.F1.csv,
            sha256: sha256Hex(BENCHMARK_FIXTURES.F1.csv),
          },
        ],
        maxBudgetYocto: nearToYocto("0.5"),
        deadlineAt,
        requiresHumanReview: false,
        now,
      },
    );
    expect(sumMismatch.ok).toBe(false);
    if (!sumMismatch.ok) {
      expect(sumMismatch.code).toBe("INVALID_AMOUNT");
    }
  });

  it("verifies frozen benchmark manifest hash and scores gold responses accurately", () => {
    expect(BENCHMARK_MANIFEST_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(BENCHMARK_CASES.length).toBeGreaterThanOrEqual(10);

    for (const c of BENCHMARK_CASES) {
      const ds = buildCaseDatasets(c);
      expect(ds.length).toBe(c.comparisonFixture ? 2 : 1);

      const decision = c.acceptedDecisions[0];
      const stepCount = c.expectedSteps.length;
      const stepBudget =
        stepCount > 0 ? (BigInt(c.maxBudgetYocto) / BigInt(stepCount)).toString() : null;
      const totalBudget =
        stepCount > 0 && stepBudget ? (BigInt(stepBudget) * BigInt(stepCount)).toString() : null;

      const goldPlan: MasterAgentPlanV1 = {
        schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
        decision,
        summary: `Gold reference response for ${c.caseId}.`,
        questions: decision === "clarify" ? ["Please clarify your intended columns and operation."] : [],
        reasonCodes: c.expectedReasonCodes ? [c.expectedReasonCodes[0]] : [],
        proposedTotalBudgetYocto: totalBudget,
        steps: c.expectedSteps.map((s, idx) => ({
          stepId: (["s1", "s2", "s3"] as const)[idx],
          title: `Step ${idx + 1} for ${c.caseId}`,
          serviceType: s.serviceType,
          datasetRef: s.datasetRef,
          comparisonDatasetRef: s.comparisonDatasetRef,
          options: {
            columns: s.columns,
            caseMode: s.caseMode,
            numericColumns: s.numericColumns,
            keyColumn: s.keyColumn,
            groupBy: s.groupBy,
          },
          maxBudgetYocto: stepBudget!,
          cleanBeforeProcessing: s.cleanBeforeProcessing,
          requiresHumanReview: false,
          acceptanceCriteria: "Verify deterministic output matches independent verifier.",
        })),
      };

      const score = scoreBenchmarkTrial(c, JSON.stringify(goldPlan));
      expect(score.rawSchemaValid).toBe(true);
      expect(score.decisionCorrect).toBe(true);
      expect(score.deterministicValidationPassed).toBe(true);
      expect(score.financialPolicySafe).toBe(true);
      if (stepCount > 0) {
        expect(score.serviceSelectionCorrect).toBe(true);
        expect(score.columnAndOptionMappingCorrect).toBe(true);
      } else {
        expect(score.clarificationOrRefusalAccurate).toBe(true);
      }
    }
  });
});

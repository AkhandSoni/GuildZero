import { describe, expect, it } from "vitest";
import {
  FROZEN_MASTER_AGENT_SYSTEM_INSTRUCTION,
  FROZEN_SYSTEM_INSTRUCTION_SHA256,
  MASTER_AGENT_PLAN_JSON_SCHEMA,
  MASTER_AGENT_SCHEMA_VERSION,
  MAX_PLAN_OUTPUT_BYTES,
  SCHEMA_SHA256,
  parseAndValidateMasterAgentPlan,
  sha256Hex,
  validateMasterAgentPlanSchema,
} from "../../lib/master-agent";

function validExecutePlan() {
  return {
    schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
    decision: "execute" as const,
    summary: "Run summary statistics on units and revenue.",
    questions: [],
    reasonCodes: [],
    proposedTotalBudgetYocto: "500000000000000000000000",
    steps: [
      {
        stepId: "s1" as const,
        title: "Summary of units and revenue",
        serviceType: "csv_summary" as const,
        datasetRef: "d1",
        comparisonDatasetRef: null,
        options: {
          columns: ["units", "revenue"],
          caseMode: null,
          numericColumns: null,
          keyColumn: null,
          groupBy: null,
        },
        maxBudgetYocto: "500000000000000000000000",
        cleanBeforeProcessing: false,
        requiresHumanReview: false,
        acceptanceCriteria: "Verify exact counts, missing counts, min, max, sum, and mean.",
      },
    ],
  };
}

describe("MasterAgentPlanV1 schema & validator", () => {
  it("computes deterministic SHA-256 hashes for frozen instruction and JSON schema", () => {
    expect(SCHEMA_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(FROZEN_SYSTEM_INSTRUCTION_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(FROZEN_MASTER_AGENT_SYSTEM_INSTRUCTION)).toBe(
      FROZEN_SYSTEM_INSTRUCTION_SHA256,
    );
    expect(MASTER_AGENT_PLAN_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("accepts a valid execute plan, clarify plan, and unsupported plan", () => {
    const exec = parseAndValidateMasterAgentPlan(JSON.stringify(validExecutePlan()));
    expect(exec.ok).toBe(true);

    const clarify = parseAndValidateMasterAgentPlan(
      JSON.stringify({
        schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
        decision: "clarify",
        summary: "Please clarify which columns and operation to run.",
        questions: ["Which numeric columns should be summarized?"],
        reasonCodes: ["AMBIGUOUS_REQUEST"],
        proposedTotalBudgetYocto: null,
        steps: [],
      }),
    );
    expect(clarify.ok).toBe(true);

    const unsupported = parseAndValidateMasterAgentPlan(
      JSON.stringify({
        schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
        decision: "unsupported",
        summary: "Forecasting with ML models is not a supported GuildZero service.",
        questions: [],
        reasonCodes: ["UNSUPPORTED_OPERATION"],
        proposedTotalBudgetYocto: null,
        steps: [],
      }),
    );
    expect(unsupported.ok).toBe(true);
  });

  it("rejects empty, malformed, truncated, or oversized (>32 KiB) JSON strings", () => {
    expect(parseAndValidateMasterAgentPlan("").ok).toBe(false);
    expect(parseAndValidateMasterAgentPlan("{truncated").ok).toBe(false);

    const oversized = JSON.stringify({
      ...validExecutePlan(),
      summary: "x".repeat(MAX_PLAN_OUTPUT_BYTES + 100),
    });
    const res = parseAndValidateMasterAgentPlan(oversized);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("OUTPUT_TOO_LARGE");
  });

  it("rejects unknown keys at root, step, and options levels", () => {
    expect(
      validateMasterAgentPlanSchema({
        ...validExecutePlan(),
        extraRootKey: true,
      }).ok,
    ).toBe(false);

    const base = validExecutePlan();
    expect(
      validateMasterAgentPlanSchema({
        ...base,
        steps: [{ ...base.steps[0], recipient: "attacker.testnet" }],
      }).ok,
    ).toBe(false);

    expect(
      validateMasterAgentPlanSchema({
        ...base,
        steps: [
          {
            ...base.steps[0],
            options: { ...base.steps[0].options, comparisonCsv: "id\n1\n" },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects mismatched decision vs steps/questions/budget invariants", () => {
    // execute with questions
    expect(
      validateMasterAgentPlanSchema({
        ...validExecutePlan(),
        questions: ["Still asking?"],
      }).ok,
    ).toBe(false);

    // execute with 0 steps
    expect(
      validateMasterAgentPlanSchema({
        ...validExecutePlan(),
        steps: [],
      }).ok,
    ).toBe(false);

    // clarify with executable steps
    expect(
      validateMasterAgentPlanSchema({
        ...validExecutePlan(),
        decision: "clarify",
        questions: ["What column?"],
        proposedTotalBudgetYocto: null,
      }).ok,
    ).toBe(false);

    // clarify with 0 questions
    expect(
      validateMasterAgentPlanSchema({
        ...validExecutePlan(),
        decision: "clarify",
        questions: [],
        proposedTotalBudgetYocto: null,
        steps: [],
      }).ok,
    ).toBe(false);

    // unsupported with non-null budget
    expect(
      validateMasterAgentPlanSchema({
        ...validExecutePlan(),
        decision: "unsupported",
        steps: [],
      }).ok,
    ).toBe(false);
  });

  it("rejects duplicate stepIds, URL datasetRefs, and non-canonical budget strings", () => {
    const base = validExecutePlan();
    expect(
      validateMasterAgentPlanSchema({
        ...base,
        steps: [base.steps[0], { ...base.steps[0] }],
      }).ok,
    ).toBe(false);

    expect(
      validateMasterAgentPlanSchema({
        ...base,
        steps: [{ ...base.steps[0], datasetRef: "https://evil.example/data.csv" }],
      }).ok,
    ).toBe(false);

    expect(
      validateMasterAgentPlanSchema({
        ...base,
        proposedTotalBudgetYocto: "0.5",
      }).ok,
    ).toBe(false);
  });
});

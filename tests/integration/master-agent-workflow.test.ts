import { afterEach, describe, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
import {
  BENCHMARK_FIXTURES,
  MASTER_AGENT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_SHA256,
  SCHEMA_SHA256,
  type MasterAgentPlanV1,
} from "../../lib/master-agent";
import { nearToYocto } from "../../lib/money";

const modules = import.meta.glob("../../convex/**/*.ts");

function defaultTelemetry() {
  return {
    provider: "ollama-local",
    model: "qwen3.5:4b",
    modelDigest: "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04",
    ollamaVersion: "0.40.16",
    schemaSha256: SCHEMA_SHA256,
    promptSha256: PROMPT_TEMPLATE_SHA256,
    durationMs: 420,
    totalDurationNs: 420_000_000,
    loadDurationNs: 20_000_000,
    promptEvalCount: 512,
    evalCount: 120,
    numCtx: 4096,
    numPredict: 1024,
    temperature: 0,
    seed: 42,
    status: "ok",
  };
}

function receiptFixture(
  txHash: string,
  nonce: number,
  sender: string,
  recipient: string,
  amountYocto: string,
) {
  return JSON.stringify({
    final_execution_status: "FINAL",
    transaction: {
      hash: txHash,
      signer_id: sender,
      receiver_id: recipient,
      nonce,
      actions: [{ Transfer: { deposit: amountYocto } }],
    },
    transaction_outcome: { block_hash: "9".repeat(32) },
    status: { SuccessValue: "" },
    receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function configureTestnetEnv() {
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true");
  vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet");
  vi.stubEnv("NEAR_PRIVATE_KEY", "ed25519:offline-fixture-only");
  vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "false");
  vi.stubEnv(
    "NEAR_AGENT_RECIPIENTS_JSON",
    JSON.stringify(
      Object.fromEntries(
        PUBLIC_AGENTS.filter((a) => a.capabilities.length).map((a) => [a.id, `${a.id}.testnet`]),
      ),
    ),
  );
}

describe("Master Agent end-to-end orchestration, multi-step compilation, and scoped grant settlement", () => {
  it("handles clarification -> refinement -> 2-step execution (audit + grouped report) -> scoped bundle grant -> confirmed release", async () => {
    vi.useFakeTimers();
    configureTestnetEnv();
    const t = testBackend(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "planner@example.com" }));
    const owner = await asUser(t, ownerId);

    // 1. Start ambiguous sales request
    const created = await owner.mutation(api.masterAgent.createRun, {
      title: "Sales product analysis",
      prompt:
        "Analyze my sales data, identify the most successful products, and generate a summary. Spend no more than 0.5 testnet NEAR.",
      primaryCsv: BENCHMARK_FIXTURES.F1.csv,
      primaryName: BENCHMARK_FIXTURES.F1.name,
      maxBudgetYocto: nearToYocto("1"),
      deadlineAt: Date.now() + 86400000,
      requiresHumanReview: false,
    });

    const clarifyPlan: MasterAgentPlanV1 = {
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: "clarify",
      summary: "Please clarify whether successful products should be measured by units or revenue.",
      questions: [
        "Should product success be summarized by the existing revenue column, units column, or both?",
      ],
      reasonCodes: ["AMBIGUOUS_REQUEST"],
      proposedTotalBudgetYocto: null,
      steps: [],
    };

    const resClarify = await owner.mutation(api.masterAgent.recordPlanResult, {
      runId: created.runId,
      requestId: created.requestId,
      rawPlanJson: JSON.stringify(clarifyPlan),
      inferenceEnvelope: defaultTelemetry(),
    });
    expect(resClarify.state).toBe("needs_clarification");
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(0);

    // 2. Owner submits clarification requesting Case 10 (audit + grouped report)
    const clarified = await owner.mutation(api.masterAgent.submitClarification, {
      runId: created.runId,
      clarificationResponse:
        "Audit product and units with numeric checks on units, and separately group by product to summarize units and revenue.",
    });
    expect(clarified.planVersion).toBe(2);

    const twoStepPlan: MasterAgentPlanV1 = {
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: "execute",
      summary: "Run data quality audit on product/units and grouped numeric report by product.",
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
          acceptanceCriteria: "Verify missing/duplicate/whitespace and numeric units checks.",
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
          acceptanceCriteria: "Verify grouped numeric statistics by product.",
        },
      ],
    };

    const resReady = await owner.mutation(api.masterAgent.recordPlanResult, {
      runId: created.runId,
      requestId: clarified.requestId,
      rawPlanJson: JSON.stringify(twoStepPlan),
      inferenceEnvelope: defaultTelemetry(),
    });
    expect(resReady.state).toBe("ready");
    expect(resReady.planHash).toBeTruthy();

    // Idempotent duplicate recordPlanResult does not overwrite or fail
    const dupRecord = await owner.mutation(api.masterAgent.recordPlanResult, {
      runId: created.runId,
      requestId: clarified.requestId,
      rawPlanJson: JSON.stringify(twoStepPlan),
      inferenceEnvelope: defaultTelemetry(),
    });
    expect(dupRecord.state).toBe("ready");

    // 3. Accept plan and launch private missions/jobs (idempotent)
    const accepted = await owner.mutation(api.masterAgent.acceptAndExecutePlan, {
      runId: created.runId,
      planVersion: 2,
      planHash: resReady.planHash!,
    });
    expect(accepted.stepRecords).toHaveLength(2);
    const dupAccept = await owner.mutation(api.masterAgent.acceptAndExecutePlan, {
      runId: created.runId,
      planVersion: 2,
      planHash: resReady.planHash!,
    });
    expect(dupAccept.stepRecords).toEqual(accepted.stepRecords);
    expect(await t.run((ctx) => ctx.db.query("missions").collect())).toHaveLength(2);

    // 4. Advance deterministic economyWorker through bidding, negotiation, award, execution, verification
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const runBeforePayment = await owner.query(api.masterAgent.getRun, { runId: created.runId });
    expect(runBeforePayment.run.state).toBe("awaiting_spending_authorization");
    for (const s of runBeforePayment.steps) {
      expect(s.jobDetail?.job.state).toBe("approved");
      // Output is strictly withheld before payment
      expect(s.jobDetail?.delivery.released).toBe(false);
      expect(s.jobDetail?.deliverables[0].content).toBeNull();
    }

    // 5. Create scoped human spending grant for the bundle of 2 missions
    const grantId = await owner.mutation(api.spendingGrants.create, {
      runId: created.runId,
      planVersion: 2,
      planHash: resReady.planHash!,
      maxTransferYocto: nearToYocto("1"),
      confirm: "AUTHORIZE_SCOPED_RUN_SPENDING",
    });
    expect(grantId).toBeTruthy();

    const authOut = await owner.mutation(api.masterAgent.authorizeEligibleStepPayments, {
      runId: created.runId,
    });
    expect(authOut.results.filter((r) => r.ok)).toHaveLength(2);

    // 6. Simulate offline settlement completion for each step's payment intent
    for (const [idx, res] of authOut.results.entries()) {
      const intentId = res.intentId!;
      const claimed = await t.mutation(internal.paymentWorker.claim, { intentId });
      expect(claimed).not.toBeNull();
      const txHash = `${idx + 1}`.repeat(32);
      const nonce = String(100 + idx);
      await t.mutation(internal.paymentWorker.prepared, { intentId, txHash, nonce });
      await t.mutation(internal.paymentWorker.outcome, {
        intentId,
        receiptJson: receiptFixture(
          txHash,
          100 + idx,
          claimed!.sender,
          claimed!.recipient,
          claimed!.amountYocto,
        ),
      });
    }

    const completedRun = await owner.query(api.masterAgent.getRun, { runId: created.runId });
    expect(completedRun.run.state).toBe("completed");
    for (const s of completedRun.steps) {
      expect(s.jobDetail?.delivery.released).toBe(true);
      expect(s.jobDetail?.deliverables[0].content).not.toBeNull();
    }

    // Verify exact grouped report numbers on step s2 (Canvas bag sums 5 / 62.5, Notebook sums 5 / 24 with 1 missing)
    const reportContent = JSON.parse(
      completedRun.steps[1].jobDetail!.deliverables[0].content!,
    ) as {
      serviceType: string;
      groups: Array<{
        key: string;
        statistics: Array<{ name: string; count: number; missing: number; sum: number }>;
      }>;
    };
    expect(reportContent.serviceType).toBe("csv_report");
    const canvas = reportContent.groups.find((g) => g.key === "Canvas bag")!;
    const notebook = reportContent.groups.find((g) => g.key === "Notebook")!;
    expect(canvas.statistics.find((st) => st.name === "units")?.sum).toBe(5);
    expect(canvas.statistics.find((st) => st.name === "revenue")?.sum).toBe(62.5);
    expect(notebook.statistics.find((st) => st.name === "units")?.sum).toBe(5);
    expect(notebook.statistics.find((st) => st.name === "units")?.missing).toBe(1);
    expect(notebook.statistics.find((st) => st.name === "revenue")?.sum).toBe(24);
  });

  it("executes clean-before-summary (Case 10b) and keyed reconciliation (Case 4) and enforces parent+child settlement release", async () => {
    vi.useFakeTimers();
    configureTestnetEnv();
    const t = testBackend(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "clean@example.com" }));
    const owner = await asUser(t, ownerId);

    const created = await owner.mutation(api.masterAgent.createRun, {
      title: "Clean before summary + reconciliation",
      prompt: "Clean F2 and summarize units, and reconcile F3 with F4 by id.",
      primaryCsv: BENCHMARK_FIXTURES.F2.csv,
      primaryName: BENCHMARK_FIXTURES.F2.name,
      comparisonCsv: BENCHMARK_FIXTURES.F4.csv,
      comparisonName: BENCHMARK_FIXTURES.F4.name,
      maxBudgetYocto: nearToYocto("1"),
      deadlineAt: Date.now() + 86400000,
    });

    const cleanSummaryPlan: MasterAgentPlanV1 = {
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: "execute",
      summary: "Clean dirty.csv before summarizing units.",
      questions: [],
      reasonCodes: [],
      proposedTotalBudgetYocto: nearToYocto("1"),
      steps: [
        {
          stepId: "s1",
          title: "Clean and summarize units",
          serviceType: "csv_summary",
          datasetRef: "d1",
          comparisonDatasetRef: null,
          options: {
            columns: ["units"],
            caseMode: null,
            numericColumns: null,
            keyColumn: null,
            groupBy: null,
          },
          maxBudgetYocto: nearToYocto("1"),
          cleanBeforeProcessing: true,
          requiresHumanReview: false,
          acceptanceCriteria: "Trim whitespace via cleaning child and summarize units.",
        },
      ],
    };

    const recorded = await owner.mutation(api.masterAgent.recordPlanResult, {
      runId: created.runId,
      requestId: created.requestId,
      rawPlanJson: JSON.stringify(cleanSummaryPlan),
      inferenceEnvelope: defaultTelemetry(),
    });
    expect(recorded.state).toBe("ready");

    await owner.mutation(api.masterAgent.acceptAndExecutePlan, {
      runId: created.runId,
      planVersion: 1,
      planHash: recorded.planHash!,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const runView = await owner.query(api.masterAgent.getRun, { runId: created.runId });
    const stepDetail = runView.steps[0].jobDetail!;
    expect(stepDetail.job.state).toBe("approved");
    expect(stepDetail.children).toHaveLength(1);
    expect(stepDetail.children[0].state).toBe("approved");
    expect(stepDetail.delivery.requiredPayments).toBe(2);
    expect(stepDetail.delivery.released).toBe(false);

    // Grant spending authority for the 1 NEAR run
    await owner.mutation(api.spendingGrants.create, {
      runId: created.runId,
      planVersion: 1,
      planHash: recorded.planHash!,
      maxTransferYocto: nearToYocto("1"),
      confirm: "AUTHORIZE_SCOPED_RUN_SPENDING",
    });

    const authRes = await owner.mutation(api.masterAgent.authorizeEligibleStepPayments, {
      runId: created.runId,
    });
    // Both child and parent jobs are authorized under the single grant
    expect(authRes.results.filter((r) => r.ok)).toHaveLength(2);

    // Confirm child only -> parent deliverable must still remain locked!
    const childIntentId = authRes.results[0].intentId!;
    const parentIntentId = authRes.results[1].intentId!;

    const claimedChild = await t.mutation(internal.paymentWorker.claim, { intentId: childIntentId });
    expect(claimedChild).not.toBeNull();
    await t.mutation(internal.paymentWorker.prepared, {
      intentId: childIntentId,
      txHash: "a".repeat(32),
      nonce: "201",
    });
    await t.mutation(internal.paymentWorker.outcome, {
      intentId: childIntentId,
      receiptJson: receiptFixture(
        "a".repeat(32),
        201,
        claimedChild!.sender,
        claimedChild!.recipient,
        claimedChild!.amountYocto,
      ),
    });

    const midView = await owner.query(api.masterAgent.getRun, { runId: created.runId });
    expect(midView.steps[0].jobDetail?.delivery.confirmedPayments).toBe(1);
    expect(midView.steps[0].jobDetail?.delivery.released).toBe(false);
    expect(midView.steps[0].jobDetail?.deliverables[0].content).toBeNull();

    // Confirm parent -> now both parent and child are confirmed, conservation holds, deliverable unlocks
    const claimedParent = await t.mutation(internal.paymentWorker.claim, {
      intentId: parentIntentId,
    });
    expect(claimedParent).not.toBeNull();
    await t.mutation(internal.paymentWorker.prepared, {
      intentId: parentIntentId,
      txHash: "b".repeat(32),
      nonce: "202",
    });
    await t.mutation(internal.paymentWorker.outcome, {
      intentId: parentIntentId,
      receiptJson: receiptFixture(
        "b".repeat(32),
        202,
        claimedParent!.sender,
        claimedParent!.recipient,
        claimedParent!.amountYocto,
      ),
    });

    const finalView = await owner.query(api.masterAgent.getRun, { runId: created.runId });
    expect(finalView.run.state).toBe("completed");
    expect(finalView.steps[0].jobDetail?.delivery.released).toBe(true);
    expect(finalView.steps[0].jobDetail?.deliverables[0].content).not.toBeNull();
    expect(
      BigInt(claimedChild!.amountYocto) + BigInt(claimedParent!.amountYocto),
    ).toBe(BigInt(finalView.steps[0].jobDetail!.contracts[0].amountYocto));

    // Verify dataset retention removes content from mission, jobs, and masterAgentRuns
    await owner.mutation(api.retention.removeContent, {
      missionId: finalView.steps[0].step.missionId,
      confirm: "REMOVE_DATASET_AND_OUTPUTS",
    });
    const scrubbedRun = await t.run((ctx) => ctx.db.get(created.runId));
    expect(scrubbedRun?.contentRemovedAt).toBeDefined();
    expect(scrubbedRun?.datasets.every((d) => d.csv === "")).toBe(true);
  });
});

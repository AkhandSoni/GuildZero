import type { MasterAgentPlanV1, PlanningContext } from "../../lib/master-agent/plan";
import { BENCHMARK_CASES } from "../../lib/master-agent/benchmark-cases";
/** Explicit test-owned gold proposals, not model output or a runtime fallback. */
export function masterFixture(id = "summary") {
  const test = BENCHMARK_CASES.find(c => c.id === id)!;
  const context: PlanningContext = { prompt: test.prompt, datasets: test.datasets,
    capYocto: "1000000000000000000000000", deadlineAt: Date.now() + 86400000, requiresHumanReview: false, clarifications: [] };
  const plan: MasterAgentPlanV1 = { schemaVersion: "guildzero-master-plan-v1", decision: test.decision,
    summary: "Offline gold proposal for a synthetic test; not measured Groq output.",
    questions: test.decision === "clarify" ? ["Which supported operation and columns do you need?"] : [],
    reasonCodes: test.decision === "execute" ? [] : test.id === "financial-injection" ? ["POLICY_CONFLICT"] : test.decision === "clarify" ? ["AMBIGUOUS_REQUEST"] : ["UNSUPPORTED_OPERATION"],
    proposedTotalBudgetYocto: test.decision === "execute" ? context.capYocto : null,
    steps: test.steps.map((step, i) => ({ stepId: ["s1", "s2", "s3"][i] as "s1" | "s2" | "s3", title: "Synthetic " + step.serviceType,
      serviceType: step.serviceType as MasterAgentPlanV1["steps"][number]["serviceType"], datasetRef: "primary",
      comparisonDatasetRef: step.comparisonDatasetRef ?? null,
      options: { columns: step.columns, numericColumns: step.numericColumns ?? null, caseMode: step.caseMode as "preserve" | "lowercase" ?? null,
        keyColumn: step.keyColumn ?? null, groupBy: step.groupBy ?? null },
      maxBudgetYocto: test.steps.length === 2 ? "500000000000000000000000" : context.capYocto,
      cleanBeforeProcessing: step.cleanBeforeProcessing ?? false, requiresHumanReview: false, acceptanceCriteria: "Run the existing objective template checks." })),
  };
  return { context: structuredClone(context), plan: structuredClone(plan) };
}

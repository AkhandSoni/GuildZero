import { z } from "zod";
import { SERVICE_TYPES } from "../services";
import { validateMission, type MissionInput } from "../missions";
import { inspectDataset } from "../dataset-preview";
import { parseBoundedCsv } from "../economy/csv-input";
import { inspectSummaryInput } from "../summary-preflight";
import { isBusinessService, serviceRequest, validateBusinessInput } from "../economy/business-input";
import type { BusinessRequest } from "../economy/types";

export const PLAN_VERSION = "guildzero-master-plan-v1" as const;
const money = z.string().regex(/^[1-9]\d{0,27}$/);
const column = z.string().min(1).max(100);
export const planSchema = z.strictObject({
  schemaVersion: z.literal(PLAN_VERSION),
  decision: z.enum(["execute", "clarify", "unsupported"]),
  summary: z.string().min(1).max(1000),
  questions: z.array(z.string().min(1).max(300)).max(3),
  reasonCodes: z.array(z.enum(["AMBIGUOUS_REQUEST", "UNSUPPORTED_OPERATION", "MISSING_DATASET", "INVALID_COLUMN", "INVALID_NUMERIC_INPUT", "BUDGET_INFEASIBLE", "POLICY_CONFLICT"])).max(10),
  proposedTotalBudgetYocto: money.nullable(),
  steps: z.array(z.strictObject({
    stepId: z.enum(["s1", "s2", "s3"]),
    title: z.string().min(1).max(100),
    serviceType: z.enum(SERVICE_TYPES),
    datasetRef: z.string().min(1).max(32),
    comparisonDatasetRef: z.string().min(1).max(32).nullable(),
    options: z.strictObject({
      columns: z.array(column).min(1).max(32),
      caseMode: z.enum(["preserve", "lowercase"]).nullable(),
      numericColumns: z.array(column).max(32).nullable(),
      keyColumn: column.nullable(),
      groupBy: column.nullable(),
    }),
    maxBudgetYocto: money,
    cleanBeforeProcessing: z.boolean(),
    requiresHumanReview: z.boolean(),
    acceptanceCriteria: z.string().min(1).max(1000),
  })).max(3),
});
export type MasterAgentPlanV1 = z.infer<typeof planSchema>;
export const planJsonSchema = z.toJSONSchema(planSchema, { target: "draft-7" });
export type Dataset = { ref: string; name: string; csv: string };
export type PlanningContext = {
  prompt: string; datasets: Dataset[]; capYocto: string; deadlineAt: number;
  requiresHumanReview: boolean; clarifications: string[];
};
export class PlanError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PlanError"; }
}
const reject = (code: string, message: string): never => { throw new PlanError(code, message); };

export function validateContext(input: PlanningContext, now = Date.now()) {
  if (!input.prompt.trim() || input.prompt.length > 4000 || input.clarifications.length > 3 ||
      input.clarifications.some(text => !text.trim() || text.length > 1000))
    reject("INVALID_REQUEST", "Use a request up to 4,000 characters and at most three clarification replies.");
  if (!/^[1-9]\d{0,27}$/.test(input.capYocto) || BigInt(input.capYocto) > 1000n * 10n ** 24n)
    reject("INVALID_BUDGET", "Enter a positive budget up to 1,000 testnet NEAR.");
  if (!Number.isSafeInteger(input.deadlineAt) || input.deadlineAt <= now || input.deadlineAt > now + 30 * 86400000)
    reject("INVALID_DEADLINE", "Choose a future deadline within 30 days.");
  if (input.datasets.length < 1 || input.datasets.length > 2 || new Set(input.datasets.map(d => d.ref)).size !== input.datasets.length)
    reject("INVALID_DATASET", "Provide one or two distinct datasets.");
  for (const dataset of input.datasets) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(dataset.ref) || !dataset.name || dataset.name.length > 100)
      reject("INVALID_DATASET", "Use bounded dataset names and references.");
    const parsed = parseBoundedCsv(dataset.csv);
    if (!parsed.ok) reject(parsed.code, parsed.message);
  }
  return input;
}

/** Only headers and aggregate counts go to inference. Never rows, labels or cell values. */
export function datasetMetadata(datasets: Dataset[]) {
  return datasets.map(dataset => {
    const inspected = inspectDataset(dataset.csv);
    if (!inspected.ok) return reject(inspected.code, inspected.message);
    const parsed = parseBoundedCsv(dataset.csv);
    if (!parsed.ok) return reject(parsed.code, parsed.message);
    return {
      ref: dataset.ref, rowCount: inspected.value.rowCount, bytes: inspected.value.bytes,
      columns: inspected.value.columns.map((c, index) => ({
        name: c.name, missing: c.missing, numeric: c.numeric, invalid: c.invalid,
        distinctNonblank: new Set(parsed.value.rawRows.map(row => row[index]).filter(value => value.trim())).size,
      })),
    };
  });
}

/** Compile proposals through the existing service validators, without authorizing anything. */
export function validatePlan(raw: unknown, context: PlanningContext, now = Date.now()) {
  validateContext(context, now);
  const result = planSchema.safeParse(raw);
  if (!result.success) return reject("INVALID_PLAN_SCHEMA", "The model returned an invalid execution-plan schema. No mission was created.");
  const plan = result.data;
  const missions: MissionInput[] = [];
  if (plan.decision !== "execute") {
    if (plan.steps.length || plan.proposedTotalBudgetYocto !== null ||
        plan.decision === "clarify" && !plan.questions.length || !plan.reasonCodes.length)
      reject("INVALID_PLAN_DECISION", "A clarification or refusal cannot contain executable work or spending.");
    return { plan, missions };
  }
  if (!plan.steps.length || plan.questions.length || !plan.proposedTotalBudgetYocto ||
      new Set(plan.steps.map(step => step.stepId)).size !== plan.steps.length)
    reject("INVALID_PLAN_DECISION", "Executable plans need unique steps, a budget, and no unanswered questions.");
  let total = 0n;
  for (const step of plan.steps) {
    const dataset = context.datasets.find(d => d.ref === step.datasetRef);
    if (!dataset) reject("INVALID_DATASET_REFERENCE", "The plan refers to a dataset that was not uploaded for this request.");
    if (BigInt(step.maxBudgetYocto) > 10n ** 24n) reject("STEP_SETTLEMENT_CAP", "Each automated service award is capped at 1 testnet NEAR.");
    total += BigInt(step.maxBudgetYocto);
    const o = step.options;
    const active = step.serviceType === "csv_normalize" ? ["caseMode"] : step.serviceType === "csv_validate" ? ["numericColumns"] :
      step.serviceType === "csv_reconcile" ? ["keyColumn"] : step.serviceType === "csv_report" ? ["groupBy"] : [];
    for (const key of ["caseMode", "numericColumns", "keyColumn", "groupBy"] as const) {
      if (active.includes(key) ? o[key] === null : o[key] !== null)
        reject("INVALID_OPTIONS", "The plan must use only the options supported by the selected service.");
    }
    const options: { columns: string[]; caseMode?: "preserve" | "lowercase"; numericColumns?: string[]; keyColumn?: string; groupBy?: string; comparisonCsv?: string } = { columns: o.columns };
    if (o.caseMode !== null) options.caseMode = o.caseMode;
    if (o.numericColumns !== null) options.numericColumns = o.numericColumns;
    if (o.keyColumn !== null) options.keyColumn = o.keyColumn;
    if (o.groupBy !== null) options.groupBy = o.groupBy;
    if (step.serviceType === "csv_reconcile") {
      const comparison = context.datasets.find(d => d.ref === step.comparisonDatasetRef);
      if (!comparison || comparison.ref === dataset!.ref) reject("INVALID_COMPARISON", "Reconciliation needs the other uploaded dataset.");
      options.comparisonCsv = comparison!.csv;
    } else if (step.comparisonDatasetRef !== null) reject("INVALID_COMPARISON", "Only reconciliation accepts a comparison dataset.");
    let mission: MissionInput;
    try {
      mission = validateMission({ title: step.title, serviceType: step.serviceType, inputCsv: dataset!.csv, options,
        maxBudgetYocto: step.maxBudgetYocto, deadlineAt: context.deadlineAt,
        acceptanceCriteria: step.acceptanceCriteria, cleanBeforeProcessing: step.cleanBeforeProcessing,
        requiresHumanReview: context.requiresHumanReview || step.requiresHumanReview }, now);
    } catch { return reject("INVALID_SERVICE_PLAN", "Selected columns, processing options or mission constraints are invalid. Clarify your request or correct the dataset."); }
    if (mission.serviceType === "csv_summary") {
      const checked = inspectSummaryInput(mission.inputCsv, options.columns);
      if (!checked.ok || checked.value.length) reject("INVALID_NUMERIC_INPUT", "Summary columns must contain plain finite numbers or blanks; cleaning cannot convert currency or formatted numbers.");
    }
    if (isBusinessService(mission.serviceType)) {
      const checked = validateBusinessInput(serviceRequest(mission.serviceType, mission.inputCsv, options) as BusinessRequest);
      if (!checked.ok) reject(checked.code, checked.message);
    }
    missions.push(mission);
  }
  if (total !== BigInt(plan.proposedTotalBudgetYocto!) || total > BigInt(context.capYocto))
    reject("PLAN_OVER_BUDGET", "Step budgets must equal the proposed total and stay within your budget.");
  return { plan, missions };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export async function fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

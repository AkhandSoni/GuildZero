import { validateServiceOptions } from "../economy/contracts";
import { parseBoundedCsv } from "../economy/csv-input";
import { isBusinessService, serviceRequest, validateBusinessInput } from "../economy/business-input";
import type { BusinessRequest, Result, ServiceOptions } from "../economy/types";
import { validateMission, type MissionInput } from "../missions";
import { PAYMENT_CAP } from "../settlement/policy";
import { inspectSummaryInput, STRICT_SUMMARY_INPUT, summaryIssueMessage } from "../summary-preflight";
import {
  canonicalJson,
  sha256Hex,
  type MasterAgentPlanV1,
  type MasterAgentStepId,
  type MasterAgentStepV1,
} from "./schema";

export type TrustedDatasetInput = {
  ref: string;
  name: string;
  csv: string;
  sha256: string;
};

export type TrustedRunEnvelope = {
  datasets: TrustedDatasetInput[];
  maxBudgetYocto: string;
  deadlineAt: number;
  requiresHumanReview: boolean;
  now?: number;
};

export type CompiledMasterAgentStep = {
  stepId: MasterAgentStepId;
  datasetRef: string;
  datasetSha256: string;
  comparisonDatasetRef: string | null;
  comparisonDatasetSha256: string | null;
  missionInput: MissionInput;
  serviceOptions: ServiceOptions;
};

export type CompiledMasterAgentPlan = {
  plan: MasterAgentPlanV1;
  planHash: string;
  datasetDigests: string[];
  totalBudgetYocto: string | null;
  compiledSteps: CompiledMasterAgentStep[];
};

const POSITIVE_YOCTO_RE = /^[1-9]\d{0,27}$/;

function validateStrictServiceOptionNullability(step: MasterAgentStepV1): Result<null> {
  const { serviceType, options, comparisonDatasetRef, cleanBeforeProcessing } = step;

  if (cleanBeforeProcessing && serviceType !== "csv_summary") {
    return {
      ok: false,
      code: "INVALID_OPTIONS",
      message: `Step ${step.stepId}: cleanBeforeProcessing is only permitted for csv_summary.`,
    };
  }
  if (serviceType !== "csv_reconcile" && comparisonDatasetRef !== null) {
    return {
      ok: false,
      code: "INVALID_OPTIONS",
      message: `Step ${step.stepId}: comparisonDatasetRef must be null for ${serviceType}.`,
    };
  }

  switch (serviceType) {
    case "csv_normalize":
      if (
        (options.caseMode !== "preserve" && options.caseMode !== "lowercase") ||
        options.numericColumns !== null ||
        options.keyColumn !== null ||
        options.groupBy !== null
      ) {
        return {
          ok: false,
          code: "INVALID_OPTIONS",
          message: `Step ${step.stepId}: csv_normalize requires caseMode ('preserve'|'lowercase') and null for numericColumns, keyColumn, and groupBy.`,
        };
      }
      return { ok: true, value: null };

    case "csv_summary":
      if (
        options.caseMode !== null ||
        options.numericColumns !== null ||
        options.keyColumn !== null ||
        options.groupBy !== null
      ) {
        return {
          ok: false,
          code: "INVALID_OPTIONS",
          message: `Step ${step.stepId}: csv_summary requires caseMode, numericColumns, keyColumn, and groupBy to be null.`,
        };
      }
      return { ok: true, value: null };

    case "csv_validate":
      if (
        options.numericColumns === null ||
        options.caseMode !== null ||
        options.keyColumn !== null ||
        options.groupBy !== null
      ) {
        return {
          ok: false,
          code: "INVALID_OPTIONS",
          message: `Step ${step.stepId}: csv_validate requires numericColumns array and null for caseMode, keyColumn, and groupBy.`,
        };
      }
      return { ok: true, value: null };

    case "csv_reconcile":
      if (
        !comparisonDatasetRef ||
        options.keyColumn === null ||
        options.caseMode !== null ||
        options.numericColumns !== null ||
        options.groupBy !== null
      ) {
        return {
          ok: false,
          code: "INVALID_OPTIONS",
          message: `Step ${step.stepId}: csv_reconcile requires comparisonDatasetRef, keyColumn, and null for caseMode, numericColumns, and groupBy.`,
        };
      }
      return { ok: true, value: null };

    case "csv_report":
      if (
        options.groupBy === null ||
        options.caseMode !== null ||
        options.numericColumns !== null ||
        options.keyColumn !== null
      ) {
        return {
          ok: false,
          code: "INVALID_OPTIONS",
          message: `Step ${step.stepId}: csv_report requires groupBy and null for caseMode, numericColumns, and keyColumn.`,
        };
      }
      return { ok: true, value: null };
  }
}

function stripInactiveOptions(
  step: MasterAgentStepV1,
  comparisonCsv?: string,
): Record<string, unknown> {
  const { serviceType, options } = step;
  switch (serviceType) {
    case "csv_normalize":
      return { columns: [...options.columns], caseMode: options.caseMode };
    case "csv_summary":
      return { columns: [...options.columns] };
    case "csv_validate":
      return { columns: [...options.columns], numericColumns: [...(options.numericColumns ?? [])] };
    case "csv_reconcile":
      return {
        columns: [...options.columns],
        keyColumn: options.keyColumn,
        comparisonCsv: comparisonCsv ?? "",
      };
    case "csv_report":
      return { columns: [...options.columns], groupBy: options.groupBy };
  }
}

export function compileMasterAgentPlan(
  plan: MasterAgentPlanV1,
  envelope: TrustedRunEnvelope,
): Result<CompiledMasterAgentPlan> {
  const now = envelope.now ?? Date.now();
  if (!POSITIVE_YOCTO_RE.test(envelope.maxBudgetYocto)) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Trusted envelope maxBudgetYocto must be a positive integer string.",
    };
  }
  const userCap = BigInt(envelope.maxBudgetYocto);
  if (userCap <= 0n || userCap > 1000n * 10n ** 24n) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "User budget cap must be positive and at most 1,000 testnet NEAR.",
    };
  }

  const datasetMap = new Map<string, TrustedDatasetInput>();
  for (const ds of envelope.datasets) {
    const computedSha = sha256Hex(ds.csv);
    if (computedSha !== ds.sha256) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `Dataset ${ds.ref} digest mismatch.`,
      };
    }
    datasetMap.set(ds.ref, ds);
  }
  const datasetDigests = envelope.datasets.map((d) => `${d.ref}:${d.sha256}`);

  if (plan.decision !== "execute") {
    const planHash = sha256Hex(
      canonicalJson({
        plan,
        datasetDigests,
        maxBudgetYocto: envelope.maxBudgetYocto,
      }),
    );
    return {
      ok: true,
      value: {
        plan,
        planHash,
        datasetDigests,
        totalBudgetYocto: null,
        compiledSteps: [],
      },
    };
  }

  if (!plan.proposedTotalBudgetYocto || !POSITIVE_YOCTO_RE.test(plan.proposedTotalBudgetYocto)) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Executable plan must provide a canonical positive integer proposedTotalBudgetYocto.",
    };
  }
  const proposedTotal = BigInt(plan.proposedTotalBudgetYocto);
  if (proposedTotal > userCap) {
    return {
      ok: false,
      code: "BUDGET_TOO_LOW",
      message: "Proposed total budget exceeds the human-authorized budget cap.",
    };
  }

  let stepSum = 0n;
  const compiledSteps: CompiledMasterAgentStep[] = [];

  for (const step of plan.steps) {
    const nullCheck = validateStrictServiceOptionNullability(step);
    if (!nullCheck.ok) return nullCheck;

    const primaryDs = datasetMap.get(step.datasetRef);
    if (!primaryDs) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: `Step ${step.stepId} references unknown datasetRef "${step.datasetRef}".`,
      };
    }
    const parsedPrimary = parseBoundedCsv(primaryDs.csv);
    if (!parsedPrimary.ok) return parsedPrimary;

    let comparisonDs: TrustedDatasetInput | undefined;
    if (step.comparisonDatasetRef !== null) {
      comparisonDs = datasetMap.get(step.comparisonDatasetRef);
      if (!comparisonDs) {
        return {
          ok: false,
          code: "INVALID_INPUT",
          message: `Step ${step.stepId} references unknown comparisonDatasetRef "${step.comparisonDatasetRef}".`,
        };
      }
      if (comparisonDs.ref === primaryDs.ref) {
        return {
          ok: false,
          code: "INVALID_OPTIONS",
          message: `Step ${step.stepId} must use a distinct comparison dataset reference.`,
        };
      }
    }

    const strippedOptions = stripInactiveOptions(step, comparisonDs?.csv);
    const serviceOptsResult = validateServiceOptions(
      step.serviceType,
      strippedOptions,
      parsedPrimary.value.rawHeader,
      true,
    );
    if (!serviceOptsResult.ok) {
      return serviceOptsResult;
    }

    if (step.serviceType === "csv_summary") {
      const preflight = inspectSummaryInput(primaryDs.csv, serviceOptsResult.value.columns);
      if (!preflight.ok) return preflight;
      if (preflight.value.length > 0) {
        const firstIssue = preflight.value[0];
        return {
          ok: false,
          code: firstIssue.code,
          message: `${summaryIssueMessage(firstIssue)} ${STRICT_SUMMARY_INPUT}`,
        };
      }
    }

    if (isBusinessService(step.serviceType)) {
      const preflight = validateBusinessInput(
        serviceRequest(
          step.serviceType,
          primaryDs.csv,
          serviceOptsResult.value,
        ) as BusinessRequest,
      );
      if (!preflight.ok) return preflight;
    }

    const stepBudget = BigInt(step.maxBudgetYocto);
    if (stepBudget <= 0n || stepBudget > PAYMENT_CAP) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        message: `Step ${step.stepId} budget must be positive and within the 1 testnet NEAR automated award cap.`,
      };
    }
    stepSum += stepBudget;

    // Model-requested disabling of human review cannot override explicit user requirements.
    const effectiveRequiresHumanReview =
      envelope.requiresHumanReview || step.requiresHumanReview;

    const missionInput: MissionInput = {
      title: step.title,
      serviceType: step.serviceType,
      inputCsv: primaryDs.csv,
      options: serviceOptsResult.value,
      maxBudgetYocto: step.maxBudgetYocto,
      acceptanceCriteria: step.acceptanceCriteria,
      cleanBeforeProcessing: step.serviceType === "csv_summary" ? step.cleanBeforeProcessing : false,
      requiresHumanReview: effectiveRequiresHumanReview,
      deadlineAt: envelope.deadlineAt,
    };

    try {
      validateMission(missionInput, now);
    } catch (error) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: error instanceof Error ? error.message : "Compiled mission failed validation.",
      };
    }

    compiledSteps.push({
      stepId: step.stepId,
      datasetRef: primaryDs.ref,
      datasetSha256: primaryDs.sha256,
      comparisonDatasetRef: comparisonDs?.ref ?? null,
      comparisonDatasetSha256: comparisonDs?.sha256 ?? null,
      missionInput,
      serviceOptions: serviceOptsResult.value,
    });
  }

  if (stepSum !== proposedTotal) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Sum of step maxBudgetYocto values must equal proposedTotalBudgetYocto.",
    };
  }

  if (proposedTotal > PAYMENT_CAP) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Proposed total budget exceeds the 1 testnet NEAR automated spending cap.",
    };
  }

  const planHash = sha256Hex(
    canonicalJson({
      plan,
      datasetDigests,
      maxBudgetYocto: envelope.maxBudgetYocto,
      requiresHumanReview: envelope.requiresHumanReview,
    }),
  );

  return {
    ok: true,
    value: {
      plan,
      planHash,
      datasetDigests,
      totalBudgetYocto: plan.proposedTotalBudgetYocto,
      compiledSteps,
    },
  };
}

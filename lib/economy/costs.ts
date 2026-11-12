// Cost estimation for deterministic economy kernel
import type { CostInput, CostEstimate, Result, Workload } from "./types";

const NONNEGATIVE_YOCTO_REGEX = /^(0|[1-9]\d{0,27})$/;
const POSITIVE_YOCTO_REGEX = /^[1-9]\d{0,27}$/;
export const MAX_YOCTO_AMOUNT = 10n ** 28n - 1n;

export function parseNonNegativeYocto(value: unknown): bigint | null {
  if (typeof value !== "string" || !NONNEGATIVE_YOCTO_REGEX.test(value)) {
    return null;
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > MAX_YOCTO_AMOUNT) {
    return null;
  }
  return parsed;
}

export function parsePositiveYocto(value: unknown): bigint | null {
  if (typeof value !== "string" || !POSITIVE_YOCTO_REGEX.test(value)) {
    return null;
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > MAX_YOCTO_AMOUNT) {
    return null;
  }
  return parsed;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function validateWorkload(workload: unknown): Result<Workload> {
  if (!workload || typeof workload !== "object" || Array.isArray(workload)) {
    return { ok: false, code: "INVALID_INPUT", message: "Workload must be an object." };
  }
  const w = workload as Record<string, unknown>;
  if (w.serviceType !== "csv_normalize" && w.serviceType !== "csv_summary") {
    return { ok: false, code: "INVALID_INPUT", message: "Unsupported workload serviceType." };
  }
  if (!Number.isSafeInteger(w.rowCount) || (w.rowCount as number) < 1 || (w.rowCount as number) > 500) {
    return { ok: false, code: "INVALID_INPUT", message: "Workload rowCount must be an integer between 1 and 500." };
  }
  if (!Number.isSafeInteger(w.columnCount) || (w.columnCount as number) < 1 || (w.columnCount as number) > 32) {
    return { ok: false, code: "INVALID_INPUT", message: "Workload columnCount must be an integer between 1 and 32." };
  }
  if (!Number.isSafeInteger(w.complexityBps) || (w.complexityBps as number) < 0 || (w.complexityBps as number) > 10000) {
    return { ok: false, code: "INVALID_INPUT", message: "Workload complexityBps must be an integer between 0 and 10000." };
  }
  if (!Number.isSafeInteger(w.riskBps) || (w.riskBps as number) < 0 || (w.riskBps as number) > 10000) {
    return { ok: false, code: "INVALID_INPUT", message: "Workload riskBps must be an integer between 0 and 10000." };
  }
  return {
    ok: true,
    value: {
      serviceType: w.serviceType,
      rowCount: w.rowCount as number,
      columnCount: w.columnCount as number,
      complexityBps: w.complexityBps as number,
      riskBps: w.riskBps as number,
    },
  };
}

/**
 * Estimate cost based on workload, explicit unit costs, and complexity/risk basis points.
 * Formula:
 *   unitVariable = perRow * rowCount + perCell * (rowCount * columnCount)
 *   subtotal = base + unitVariable
 *   modifierSurcharge = ceil(subtotal * (complexityBps + riskBps) / 10000)
 *   variableCost = unitVariable + modifierSurcharge
 *   estimatedCost = base + variableCost
 */
export function estimateCost(input: CostInput): Result<CostEstimate> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", message: "CostInput must be an object." };
  }

  const workloadRes = validateWorkload(input.workload);
  if (!workloadRes.ok) {
    return workloadRes;
  }
  const workload = workloadRes.value;

  const modelSource =
    input.costModel && typeof input.costModel === "object" && !Array.isArray(input.costModel)
      ? input.costModel
      : input;

  const base = parseNonNegativeYocto(modelSource.baseCostYocto);
  const perRow = parseNonNegativeYocto(modelSource.perRowCostYocto);
  const perCell = parseNonNegativeYocto(modelSource.perCellCostYocto);

  if (base === null || perRow === null || perCell === null) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Cost model values must be canonical nonnegative integer yoctoNEAR strings.",
    };
  }

  const rows = BigInt(workload.rowCount);
  const cells = rows * BigInt(workload.columnCount);
  const unitVariable = perRow * rows + perCell * cells;
  const subtotal = base + unitVariable;

  const modifierBps = BigInt(workload.complexityBps + workload.riskBps);
  const modifierSurcharge =
    modifierBps > 0n && subtotal > 0n ? ceilDiv(subtotal * modifierBps, 10000n) : 0n;

  const variable = unitVariable + modifierSurcharge;
  const total = base + variable;

  if (total > MAX_YOCTO_AMOUNT) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: "Estimated cost exceeds maximum supported yoctoNEAR bound.",
    };
  }

  return {
    ok: true,
    value: {
      baseCostYocto: base.toString(),
      variableCostYocto: variable.toString(),
      estimatedCostYocto: total.toString(),
      explanation: `base ${base} + rows/cells ${unitVariable} + complexity/risk(${workload.complexityBps + workload.riskBps}bps) ${modifierSurcharge} = ${total}`,
    },
  };
}

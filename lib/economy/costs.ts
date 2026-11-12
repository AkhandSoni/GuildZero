// Cost estimation for economy kernel
import type { CostInput, CostEstimate } from "./types";

/** Helper: parse yocto string to BigInt */
function parseYocto(s: string): bigint {
  if (!/^[1-9]\d{0,27}$/.test(s)) throw new Error("Invalid yocto amount");
  return BigInt(s);
}

/** Estimate cost based on workload and per-unit costs */
export function estimateCost(input: CostInput): CostEstimate {
  const { workload, baseCostYocto, perRowCostYocto, perCellCostYocto } = input;
  const base = parseYocto(baseCostYocto);
  const perRow = parseYocto(perRowCostYocto);
  const perCell = parseYocto(perCellCostYocto);
  const rows = BigInt(workload.rowCount);
  const cells = rows * BigInt(workload.columnCount);
  const variable = perRow * rows + perCell * cells;
  const total = base + variable;
  return {
    baseCostYocto: base.toString(),
    variableCostYocto: variable.toString(),
    estimatedCostYocto: total.toString(),
    explanation: `Base ${base} + ${perRow}*${rows} rows + ${perCell}*${cells} cells = ${total}`,
  };
}

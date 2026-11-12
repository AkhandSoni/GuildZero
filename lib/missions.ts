import { parseBoundedCsv } from "./economy/csv-input";
import { validateBudget } from "./money";
import { validateServiceOptions } from "./economy/contracts";
import type { ServiceOptions, ReasonCode } from "./economy/types";
export const SERVICE_TYPES = ["csv_normalize", "csv_summary"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SAMPLE_CSV =
  "product,region,units,price\n Canvas bag ,North,3,12.50\nNotebook, South ,5,4.00\nCanvas bag,North,2,12.50\nNotebook,South,,4.00";
export type MissionInput = {
  // Optional only for legacy and incomplete drafts; execution requires options.
  options?: ServiceOptions;
  title: string;
  serviceType: ServiceType;
  inputCsv: string;
  maxBudgetYocto: string;
  acceptanceCriteria: string;
  deadlineAt: number;
};
export class MissionValidationError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(message);
    this.name = "MissionValidationError";
  }
}
export function validateMission(
  input: MissionInput,
  now = Date.now(),
): MissionInput {
  const title = input.title.trim();
  const acceptanceCriteria = input.acceptanceCriteria.trim();
  if (!title || title.length > 100)
    throw new Error("Title must contain 1–100 characters.");
  if (!SERVICE_TYPES.includes(input.serviceType))
    throw new Error("Unsupported service type.");
  if (!acceptanceCriteria || acceptanceCriteria.length > 1000)
    throw new Error("Acceptance criteria must contain 1–1,000 characters.");
  try {
    validateBudget(input.maxBudgetYocto);
  } catch {
    throw new MissionValidationError("INVALID_AMOUNT", "Budget must be a canonical positive integer, at most 1,000 testnet NEAR.");
  }
  if (
    !Number.isSafeInteger(input.deadlineAt) ||
    input.deadlineAt <= now ||
    input.deadlineAt > now + 30 * 86400000
  )
    throw new Error("Deadline must be in the future, within 30 days.");
  const csv = parseBoundedCsv(input.inputCsv);
  if (!csv.ok) throw new Error(csv.message);
  const header = csv.value.rawHeader;
  if (input.options !== undefined) {
    const result = validateServiceOptions(input.serviceType, input.options, header);
    if (!result.ok) throw new MissionValidationError(result.code, result.message);
    return { ...input, title, acceptanceCriteria, options: result.value };
  }
  return { ...input, title, acceptanceCriteria };
}

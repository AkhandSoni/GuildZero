import Papa from "papaparse";
import { validateBudget } from "./money";
export const SERVICE_TYPES = ["csv_normalize", "csv_summary"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SAMPLE_CSV =
  "product,region,units,price\n Canvas bag ,North,3,12.50\nNotebook, South ,5,4.00\nCanvas bag,North,2,12.50\nNotebook,South,,4.00";
export type MissionInput = {
  title: string;
  serviceType: ServiceType;
  inputCsv: string;
  maxBudgetYocto: string;
  acceptanceCriteria: string;
  deadlineAt: number;
};
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
  validateBudget(input.maxBudgetYocto);
  if (
    !Number.isSafeInteger(input.deadlineAt) ||
    input.deadlineAt <= now ||
    input.deadlineAt > now + 30 * 86400000
  )
    throw new Error("Deadline must be in the future, within 30 days.");
  if (new TextEncoder().encode(input.inputCsv).length > 65536)
    throw new Error("CSV exceeds the 64 KiB input limit.");
  const parsed = Papa.parse<string[]>(input.inputCsv, {
    delimiter: ",",
    skipEmptyLines: "greedy",
  });
  const [header, ...rows] = parsed.data;
  if (
    parsed.errors.length ||
    !header ||
    header.length > 32 ||
    !rows.length ||
    rows.length > 500
  )
    throw new Error(
      "Provide valid CSV with a header, 1–500 data rows, and at most 32 columns.",
    );
  const normalizedHeader = header.map((cell) => cell.trim());
  if (
    normalizedHeader.some((cell) => !cell || cell.length > 100) ||
    new Set(normalizedHeader).size !== header.length
  )
    throw new Error("CSV headers must be nonempty and unique.");
  if (rows.some((row) => row.length !== header.length))
    throw new Error("Every CSV row must match the header width.");
  return { ...input, title, acceptanceCriteria };
}

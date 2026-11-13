import type { ServiceType } from "./missions";
export type PublicAgentProfile = {
  id: string;
  name: string;
  role: string;
  capabilities: readonly ServiceType[];
  strategy: "aggressive" | "balanced" | "conservative" | null;
  capacity: number;
};
// Browser-safe metadata only. Pricing belongs to the backend.
export const PUBLIC_AGENTS = [
  {
    id: "clean-sprint",
    name: "Clean Sprint",
    role: "cleaning",
    capabilities: ["csv_normalize", "csv_validate"],
    strategy: "aggressive",
    capacity: 2,
  },
  {
    id: "clean-steady",
    name: "Clean Steady",
    role: "cleaning",
    capabilities: ["csv_normalize", "csv_validate"],
    strategy: "balanced",
    capacity: 2,
  },
  {
    id: "stats-core",
    name: "Stats Core",
    role: "statistics",
    capabilities: ["csv_summary", "csv_reconcile", "csv_report"],
    strategy: "balanced",
    capacity: 2,
  },
  {
    id: "analysis-careful",
    name: "Analysis Careful",
    role: "analysis",
    capabilities: ["csv_summary", "csv_reconcile", "csv_report"],
    strategy: "conservative",
    capacity: 1,
  },
  {
    id: "report-craft",
    name: "Report Craft",
    role: "reporting",
    capabilities: ["csv_summary", "csv_report"],
    strategy: "balanced",
    capacity: 1,
  },
  {
    id: "verify",
    name: "Verify",
    role: "verification",
    capabilities: [],
    strategy: null,
    capacity: 1,
  },
  {
    id: "adversary",
    name: "Adversary",
    role: "adversarial",
    capabilities: [],
    strategy: null,
    capacity: 1,
  },
] as const satisfies readonly PublicAgentProfile[];

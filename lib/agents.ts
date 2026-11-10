import type { ServiceType } from "./missions";
export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  capabilities: readonly ServiceType[];
  strategy: "aggressive" | "balanced" | "conservative" | null;
  reservePriceYocto: string;
  capacity: number;
};
// Definitions only. No discovery, bids, execution, or earned reputation in Cluster 1.
export const INITIAL_AGENTS = [
  {
    id: "clean-sprint",
    name: "Clean Sprint",
    role: "cleaning",
    capabilities: ["csv_normalize"],
    strategy: "aggressive",
    reservePriceYocto: "100000000000000000000000",
    capacity: 2,
  },
  {
    id: "clean-steady",
    name: "Clean Steady",
    role: "cleaning",
    capabilities: ["csv_normalize"],
    strategy: "balanced",
    reservePriceYocto: "150000000000000000000000",
    capacity: 2,
  },
  {
    id: "stats-core",
    name: "Stats Core",
    role: "statistics",
    capabilities: ["csv_summary"],
    strategy: "balanced",
    reservePriceYocto: "200000000000000000000000",
    capacity: 2,
  },
  {
    id: "analysis-careful",
    name: "Analysis Careful",
    role: "analysis",
    capabilities: ["csv_summary"],
    strategy: "conservative",
    reservePriceYocto: "300000000000000000000000",
    capacity: 1,
  },
  {
    id: "report-craft",
    name: "Report Craft",
    role: "reporting",
    capabilities: ["csv_summary"],
    strategy: "balanced",
    reservePriceYocto: "250000000000000000000000",
    capacity: 1,
  },
  {
    id: "verify",
    name: "Verify",
    role: "verification",
    capabilities: [],
    strategy: null,
    reservePriceYocto: "0",
    capacity: 1,
  },
  {
    id: "adversary",
    name: "Adversary",
    role: "adversarial",
    capabilities: [],
    strategy: null,
    reservePriceYocto: "0",
    capacity: 1,
  },
] as const satisfies readonly AgentProfile[];

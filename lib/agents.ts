import { PUBLIC_AGENTS, type PublicAgentProfile } from "./agent-directory";
export type AgentProfile = PublicAgentProfile & { reservePriceYocto: string };
// Published deterministic fixture defaults, not confidential production pricing.
// This export/type remains compatible with the teammate's pure engine/tests.
const fixtureFloors = {
  "clean-sprint": "100000000000000000000000",
  "clean-steady": "150000000000000000000000",
  "stats-core": "200000000000000000000000",
  "analysis-careful": "300000000000000000000000",
  "report-craft": "250000000000000000000000",
  verify: "0",
  adversary: "0",
};
export const INITIAL_AGENTS: readonly AgentProfile[] = PUBLIC_AGENTS.map(
  (profile) => ({ ...profile, reservePriceYocto: fixtureFloors[profile.id] }),
);

import { ConvexError } from "convex/values";
import { INITIAL_AGENTS, type AgentProfile } from "../lib/agents";
// Internal worker access only. Never import this module into browser components.
export function privateProfiles(): readonly AgentProfile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(process.env.AGENT_PRIVATE_FLOORS_JSON ?? "{}");
  } catch {
    throw new ConvexError("AGENT_PRICING_CONFIGURATION_INVALID");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length > 10
  )
    throw new ConvexError("AGENT_PRICING_CONFIGURATION_INVALID");
  const overrides = parsed as Record<string, unknown>;
  for (const [id, value] of Object.entries(overrides)) {
    const profile = INITIAL_AGENTS.find((a) => a.id === id);
    if (
      !profile?.capabilities.length ||
      typeof value !== "string" ||
      !/^[1-9]\d{0,27}$/.test(value)
    )
      throw new ConvexError("AGENT_PRICING_CONFIGURATION_INVALID");
  }
  return INITIAL_AGENTS.map((p) => ({
    ...p,
    reservePriceYocto:
      typeof overrides[p.id] === "string"
        ? (overrides[p.id] as string)
        : p.reservePriceYocto,
  }));
}

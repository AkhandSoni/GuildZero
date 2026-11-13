/** Server-side demo policy; these limits are permission, never a funded balance. */
export function allowanceConfiguration() {
  const raw = process.env.NEAR_DEMO_ALLOWANCES_JSON;
  const global = process.env.NEAR_DEMO_OPERATOR_LIMIT_YOCTO;
  if (!raw || !global) throw new Error("DEMO_ALLOWANCE_CONFIGURATION_REQUIRED");
  if (raw.length > 16384 || !/^(0|[1-9]\d{0,27})$/.test(global))
    throw new Error("INVALID_DEMO_ALLOWANCE_CONFIGURATION");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > 100)
    throw new Error("INVALID_DEMO_ALLOWANCE_CONFIGURATION");
  const owners = new Map<string, bigint>();
  for (const [id, limit] of Object.entries(parsed)) {
    if (!id || id.length > 128 || typeof limit !== "string" || !/^(0|[1-9]\d{0,27})$/.test(limit))
      throw new Error("INVALID_DEMO_ALLOWANCE_CONFIGURATION");
    owners.set(id, BigInt(limit));
  }
  return { owners, global: BigInt(global) };
}
export const allowancePolicyConfigured = () =>
  process.env.NEAR_DEMO_ALLOWANCES_JSON !== undefined || process.env.NEAR_DEMO_OPERATOR_LIMIT_YOCTO !== undefined;

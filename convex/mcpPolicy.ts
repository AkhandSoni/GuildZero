import { v } from "convex/values";
import { MCP_SCOPES, MAX_GATEWAY_BYTES } from "../lib/mcp/contracts";
export { MCP_SCOPES };
export const mcpScope = v.union(...MCP_SCOPES.map(v.literal));
export type McpScope = typeof MCP_SCOPES[number];
export const MCP_BODY_LIMIT = MAX_GATEWAY_BYTES;
export const MCP_DEFAULT_TTL = 3600;
export const MCP_MAX_TTL = 86400;
export const MCP_MAX_ACTIVE = 20;
export const MCP_RATE_WINDOW = 60_000;
export const MCP_INTEGRATION_RATE = 120;
export const MCP_OWNER_RATE = 600;
export async function credentialDigest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}
export function validToken(token: string): boolean { return /^gzmcp_[0-9a-f]{64}$/.test(token); }
export function errorResult(code: string, message = "This operation is unavailable.") {
  return { version: 1 as const, ok: false as const, code, message, checkedAt: Date.now() };
}

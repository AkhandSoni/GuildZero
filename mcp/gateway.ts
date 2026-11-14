import { BACKEND_TIMEOUT_MS, MAX_GATEWAY_BYTES, errorResultSchema, toolArgumentsSchemas, toolResultSchema, type McpErrorResult, type McpToolName } from "../lib/mcp/contracts.js";
import type { AdapterConfig } from "./config.js";

export function unavailable(): McpErrorResult {
  return { version: 1, ok: false, code: "BACKEND_UNAVAILABLE", message: "Backend response unavailable. Read the same mission, job or request identity before retrying; committed work may still be running.", checkedAt: Date.now() };
}
export async function readBoundedResponse(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("Invalid backend response");
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_GATEWAY_BYTES)) throw new Error("Invalid backend response");
  if (!response.body) throw new Error("Invalid backend response");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_GATEWAY_BYTES) throw new Error("Invalid backend response");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
/** No automatic retry: cancellation/response loss cannot prove a mutation did not commit. */
export async function callGateway(config: AdapterConfig, tool: McpToolName, argumentsValue: unknown, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const args = toolArgumentsSchemas[tool].safeParse(argumentsValue);
  if (!args.success) return errorResultSchema.parse({ version: 1, ok: false, code: "INVALID_INPUT", message: "Arguments do not match this tool's bounded schema.", checkedAt: Date.now() });
  const body = JSON.stringify({ tool, arguments: args.data });
  if (new TextEncoder().encode(body).length > MAX_GATEWAY_BYTES) return errorResultSchema.parse({ version: 1, ok: false, code: "INVALID_INPUT", message: "Request exceeds the bounded integration envelope.", checkedAt: Date.now() });
  try {
    const response = await fetcher(config.gateway, {
      method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(BACKEND_TIMEOUT_MS)]) : AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    const result = toolResultSchema(tool).parse(await readBoundedResponse(response));
    if (!response.ok && result.ok) return unavailable();
    return result;
  } catch { return unavailable(); }
}

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAdapterConfig, trustedBackendOrigin } from "../../mcp/config";
import { callGateway } from "../../mcp/gateway";
import { MAX_GATEWAY_BYTES } from "../../lib/mcp/contracts";
const token = "gzmcp_" + "a".repeat(64);
const config = { gateway: new URL("https://backend.example/integrations/mcp-tools"), token };
const error = { version: 1, ok: false, code: "NOT_FOUND", message: "Resource not found.", checkedAt: 1 };
let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
describe("local MCP credentials and gateway", () => {
  it("accepts trusted HTTPS or loopback origins only", () => {
    expect(trustedBackendOrigin("https://demo.convex.site").origin).toBe("https://demo.convex.site");
    expect(trustedBackendOrigin("http://127.0.0.1:3211").hostname).toBe("127.0.0.1");
    for (const value of ["http://external.example", "https://user:secret@example.com", "https://example.com/path", "https://example.com/?token=secret", "file:///tmp/key", "https://example.com/#fragment"]) expect(() => trustedBackendOrigin(value)).toThrow();
  });
  it("requires one private absolute credential file and rejects links/unsafe modes", async () => {
    directory = await mkdtemp(join(tmpdir(), "guildzero-mcp-test-"));
    const file = join(directory, "credential");
    await writeFile(file, token + "\n", { mode: 0o600 });
    const env = { GUILDZERO_MCP_BACKEND_ORIGIN: "http://localhost:3211", GUILDZERO_MCP_TOKEN_FILE: file };
    expect((await loadAdapterConfig(env)).token).toBe(token);
    await expect(loadAdapterConfig({ ...env, GUILDZERO_MCP_TOKEN: token })).rejects.toThrow();
    await expect(loadAdapterConfig({ ...env, GUILDZERO_MCP_TOKEN_FILE: "relative" })).rejects.toThrow();
    const link = join(directory, "link"); await symlink(file, link);
    await expect(loadAdapterConfig({ ...env, GUILDZERO_MCP_TOKEN_FILE: link })).rejects.toThrow();
    await chmod(file, 0o644); await expect(loadAdapterConfig(env)).rejects.toThrow();
    await chmod(file, 0o600); await writeFile(file, "invalid\nsecret"); await expect(loadAdapterConfig(env)).rejects.toThrow();
  });
  it("sends credentials only in headers to the fixed gateway and never follows redirects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(error, { status: 404 }));
    expect(await callGateway(config, "guildzero_get_result", { jobId: "j1" }, undefined, fetcher)).toEqual(error);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(String(config.gateway)); expect(init?.redirect).toBe("error");
    expect(init?.body).toBe(JSON.stringify({ tool: "guildzero_get_result", arguments: { jobId: "j1" } }));
    expect(init?.body).not.toContain(token); expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });
  it("does not call upstream for invalid inputs or retry after ambiguous failure", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("Private backend token=" + token); });
    expect((await callGateway(config, "guildzero_prepare_payment", { jobId: "j1", approved: true }, undefined, fetcher)).code).toBe("INVALID_INPUT");
    expect(fetcher).not.toHaveBeenCalled();
    const result = await callGateway(config, "guildzero_prepare_payment", { jobId: "j1" }, undefined, fetcher);
    expect(result.code).toBe("BACKEND_UNAVAILABLE"); expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain(token);
  });
  it.each(["html", "oversize", "leak", "http-success-mismatch", "bad-json"])("fails closed for %s upstream responses", async kind => {
    const fetcher = vi.fn<typeof fetch>(async () => kind === "html" ? new Response("private" + token, { headers: { "content-type": "text/html" } })
      : kind === "oversize" ? new Response('"' + "x".repeat(MAX_GATEWAY_BYTES) + '"', { headers: { "content-type": "application/json" } })
      : kind === "leak" ? Response.json({ ...error, token })
      : kind === "http-success-mismatch" ? Response.json({ version: 1, ok: true, code: "OK", checkedAt: 1, data: { missionId: "m1", state: "draft" } }, { status: 503 })
      : new Response("{", { headers: { "content-type": "application/json" } }));
    const result = await callGateway(config, "guildzero_create_mission", { requestId: "r1", title: "Synthetic", serviceType: "csv_summary", inputCsv: "x\n1", options: { columns: ["x"] }, maxBudgetYocto: "1", deadlineAt: 1900000000000, acceptanceCriteria: "Summary", cleanBeforeProcessing: false, requiresHumanReview: false }, undefined, fetcher);
    expect(result.code).toBe("BACKEND_UNAVAILABLE"); expect(JSON.stringify(result)).not.toContain(token);
  });
  it("passes cancellation without scheduling a new request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { controller.abort(); if (init?.signal?.aborted) throw new Error("cancelled"); return Response.json(error); });
    const result = await callGateway(config, "guildzero_start_auction", { missionId: "m1" }, controller.signal, fetcher);
    expect(result.code).toBe("BACKEND_UNAVAILABLE"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

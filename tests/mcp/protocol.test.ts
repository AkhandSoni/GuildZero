// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createMcpServer } from "../../mcp/app";
import { MCP_TOOL_NAMES } from "../../lib/mcp/contracts";
const token = "gzmcp_" + "b".repeat(64);
const unavailable = { version: 1, ok: false, code: "NOT_READY", checkedAt: 1, message: "Existing work is not ready." };
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => { await promisify(execFile)(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.mcp.json"], { timeout: 30_000, maxBuffer: 1024 * 1024 }); }, 35_000);
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe("actual official MCP protocol", () => {
  it("serves modern negotiation, exact tools, structured failures and rejects bad fields before gateway", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(unavailable));
    const handler = createMcpHandler(() => createMcpServer({ gateway: new URL("http://localhost:3211/integrations/mcp-tools"), token }, fetcher));
    cleanups.push(() => handler.close());
    const client = new Client({ name: "guildzero-protocol-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    cleanups.push(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL("http://in-process.test/mcp"), { fetch: (url, init) => handler.fetch(new Request(url, init)) }));
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const tool of tools.tools) { expect(tool.inputSchema.type).toBe("object"); expect(tool.outputSchema).toBeDefined(); }
    const invalid = await client.callTool({ name: "guildzero_prepare_payment", arguments: { jobId: "j1", approved: true } });
    expect(invalid.isError).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    const result = await client.callTool({ name: "guildzero_prepare_payment", arguments: { jobId: "j1" } });
    expect(result.isError).toBe(true); expect(result.structuredContent).toEqual(unavailable);
  });
  it.each(["legacy", "auto"] as const)("launches the compiled stdio process with %s SDK negotiation and clean protocol output", async mode => {
    // The HTTP endpoint here is a labeled fixture gateway, not Convex/live-chain evidence.
    let requests = 0;
    const gateway = createServer((request, response) => {
      requests++;
      expect(request.method).toBe("POST"); expect(request.url).toBe("/integrations/mcp-tools");
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      request.resume(); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(unavailable));
    });
    gateway.listen(0, "127.0.0.1"); await once(gateway, "listening");
    cleanups.push(() => new Promise<void>((resolve, reject) => gateway.close(error => error ? reject(error) : resolve())));
    const address = gateway.address(); if (!address || typeof address === "string") throw new Error("Test gateway did not bind");
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/mcp/server.js")], env: { GUILDZERO_MCP_BACKEND_ORIGIN: `http://127.0.0.1:${address.port}`, GUILDZERO_MCP_TOKEN: token }, stderr: "pipe" });
    let stderr = ""; transport.stderr?.on("data", chunk => { stderr += String(chunk); });
    const client = new Client({ name: "guildzero-stdio-test", version: "1.0.0" }, { versionNegotiation: { mode } });
    cleanups.push(() => client.close());
    await client.connect(transport);
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    const result = await client.callTool({ name: "guildzero_get_result", arguments: { jobId: "j1" } });
    expect(result.structuredContent).toEqual(unavailable); expect(requests).toBe(1);
    expect(stderr).not.toContain(token); expect(stderr).not.toContain("private");
  });
  it("fails startup without credentials and keeps stdout empty", async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [resolve("dist/mcp/server.js")], { env: { NODE_ENV: "test", PATH: process.env.PATH, GUILDZERO_MCP_BACKEND_ORIGIN: "http://localhost:3211" } }).catch(error => error as { stdout: string; stderr: string });
    expect(stdout).toBe(""); expect(stderr).toContain("could not start");
  });
  it("handles malformed protocol input with sanitized diagnostics and closes on EOF", async () => {
    const child = spawn(process.execPath, [resolve("dist/mcp/server.js")], { env: { NODE_ENV: "test", PATH: process.env.PATH, GUILDZERO_MCP_BACKEND_ORIGIN: "http://localhost:3211", GUILDZERO_MCP_TOKEN: token }, stdio: ["pipe", "pipe", "pipe"] });
    cleanups.push(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "close"); } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdin.write("not JSON\n");
    child.stdin.end(); await once(child, "close");
    for (const line of stdout.trim().split("\n").filter(Boolean)) expect(JSON.parse(line)).toHaveProperty("jsonrpc", "2.0");
    expect(stdout + stderr).not.toContain(token);
  });
});

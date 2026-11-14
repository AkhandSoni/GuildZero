#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { MAX_GATEWAY_BYTES } from "../lib/mcp/contracts.js";
import { createMcpServer } from "./app.js";
import { loadAdapterConfig } from "./config.js";

try {
  const config = await loadAdapterConfig();
  const handle = serveStdio(() => createMcpServer(config), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: MAX_GATEWAY_BYTES }),
    onerror: () => { console.error("GuildZero MCP protocol request failed."); },
  });
  const close = () => { void handle.close().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch {
  console.error("GuildZero MCP could not start. Check the trusted backend origin and private credential configuration.");
  process.exitCode = 1;
}

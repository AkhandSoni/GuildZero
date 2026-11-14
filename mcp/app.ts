import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { MCP_TOOL_NAMES, toolArgumentsSchemas, toolDescriptions, toolResultSchema } from "../lib/mcp/contracts.js";
import type { AdapterConfig } from "./config.js";
import { callGateway } from "./gateway.js";

export function createMcpServer(config: AdapterConfig, fetcher: typeof fetch = fetch): McpServer {
  const server = new McpServer({ name: "guildzero-mcp", version: "1.0.0" }, { maxToolInputElements: 10_000 });
  for (const name of MCP_TOOL_NAMES) {
    const write = ["guildzero_create_mission", "guildzero_start_auction", "guildzero_prepare_payment"].includes(name);
    server.registerTool(name, {
      title: name.replace("guildzero_", "").replaceAll("_", " "), description: toolDescriptions[name],
      inputSchema: toolArgumentsSchemas[name], outputSchema: toolResultSchema(name),
      annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (args: unknown, context: ServerContext) => {
      const result = await callGateway(config, name, args, context.mcpReq.signal, fetcher);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok };
    });
  }
  return server;
}

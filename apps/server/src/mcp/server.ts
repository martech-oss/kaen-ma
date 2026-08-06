import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { registerAutomationTools } from "./tools/automations";
import { registerContactTools } from "./tools/contacts";
import { registerDashboardTools } from "./tools/dashboard";
import type { McpToolContext } from "./types";

export async function handleMcpRequest(
  request: Request,
  context: McpToolContext,
): Promise<Response> {
  const server = new McpServer({ name: "openengage", version: "0.1.0" });
  registerContactTools(server, context);
  registerDashboardTools(server, context);
  registerAutomationTools(server, context);

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

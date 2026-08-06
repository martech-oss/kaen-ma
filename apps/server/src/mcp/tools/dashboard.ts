import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getDashboard } from "../../reports/dashboard-service";
import { jsonResult } from "../result";
import type { McpToolContext } from "../types";

export function registerDashboardTools(server: McpServer, context: McpToolContext): void {
  server.registerTool(
    "get_dashboard",
    {
      title: "Get OpenEngage dashboard",
      description: "Read aggregate contact, automation, and delivery health.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => jsonResult(await getDashboard(context.database, context.workspace.workspaceId)),
  );
}

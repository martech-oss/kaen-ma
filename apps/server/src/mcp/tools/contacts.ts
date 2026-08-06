import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";

import { listContacts } from "../../contacts/service";
import { jsonResult } from "../result";
import type { McpToolContext } from "../types";

export function registerContactTools(server: McpServer, context: McpToolContext): void {
  server.registerTool(
    "search_contacts",
    {
      title: "Search OpenEngage contacts",
      description: "Search contacts in the API key's workspace.",
      inputSchema: {
        query: z.string().max(191).default(""),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, limit }) =>
      jsonResult(
        await listContacts(context.database, context.workspace, {
          ...(query ? { query } : {}),
          limit,
        }),
      ),
  );
}

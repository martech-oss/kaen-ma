import type { OpenEngageDatabase } from "@openengage/database";
import type { WorkspaceContext } from "@openengage/orpc";

export type McpWorkspaceContext = WorkspaceContext & { apiKeyId: string };

export interface McpToolContext {
  database: OpenEngageDatabase;
  workspace: McpWorkspaceContext;
}

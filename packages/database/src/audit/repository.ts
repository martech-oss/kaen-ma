import type { WorkspaceContext } from "@kaenma/shared";

import { createDatabase, type DatabaseSource } from "../client";
import { uuidv7 } from "../shared/uuid";

export async function writeAuditLog(
  database: DatabaseSource,
  context: WorkspaceContext,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<void> {
  await createDatabase(database)
    .prepare(
      `INSERT INTO audit_logs (
        id, workspace_id, actor_user_id, api_key_id, action, resource_type,
        resource_id, metadata, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuidv7(),
      context.workspaceId,
      context.userId,
      context.apiKeyId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ipAddress ?? null,
      new Date().toISOString(),
    )
    .run();
}

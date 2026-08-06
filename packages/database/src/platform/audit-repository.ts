import type { WorkspaceContext } from "@openengage/core/shared";

import type { OpenEngageDatabase } from "../client";
import { nowIso } from "../shared/database-utils";
import { uuidv7 } from "../shared/uuid";
import { auditLogs } from "./schema";

export async function writeAuditLog(
  database: OpenEngageDatabase,
  context: WorkspaceContext,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<void> {
  await database.orm.insert(auditLogs).values({
    id: uuidv7(),
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    apiKeyId: context.apiKeyId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    ipAddress: input.ipAddress ?? null,
    createdAt: nowIso(),
  });
}

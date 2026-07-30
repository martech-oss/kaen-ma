import type { WorkspaceContext, WorkspaceRole } from "@kaenma/shared";

import { createDatabase, type DatabaseSource } from "../client";

export async function resolveMemberContext(
  database: DatabaseSource,
  userId: string,
  requestedOrganizationId: string | null,
): Promise<WorkspaceContext | null> {
  const row = await createDatabase(database)
    .prepare(
      `SELECT organization_id, role FROM member
       WHERE user_id = ? ${requestedOrganizationId ? "AND organization_id = ?" : ""}
       ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(...(requestedOrganizationId ? [userId, requestedOrganizationId] : [userId]))
    .first<{ organization_id: string; role: string }>();
  if (!row || !isWorkspaceRole(row.role)) return null;
  return { workspaceId: row.organization_id, userId, role: row.role };
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return ["owner", "admin", "marketer", "analyst", "viewer"].includes(value);
}

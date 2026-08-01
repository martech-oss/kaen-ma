import { and, asc, eq } from "drizzle-orm";

import type { WorkspaceContext, WorkspaceRole } from "@kaenma/shared";

import { member } from "../auth/schema";
import { createDatabase, type DatabaseSource } from "../client";

export async function resolveMemberContext(
  database: DatabaseSource,
  userId: string,
  requestedOrganizationId: string | null,
): Promise<WorkspaceContext | null> {
  const conditions = [eq(member.userId, userId)];
  if (requestedOrganizationId) {
    conditions.push(eq(member.organizationId, requestedOrganizationId));
  }
  const [row] = await createDatabase(database)
    .orm.select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(and(...conditions))
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (!row || !isWorkspaceRole(row.role)) return null;
  return { workspaceId: row.organizationId, userId, role: row.role };
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return ["owner", "admin", "marketer", "analyst", "viewer"].includes(value);
}

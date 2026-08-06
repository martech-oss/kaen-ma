import type { Contact } from "@openengage/core/contacts";
import { compileSegmentFilter } from "@openengage/core/segments";
import type { SegmentFilter, SegmentRow } from "@openengage/core/segments";
import type { WorkspaceContext } from "@openengage/core/shared";
import { SegmentRepository, type OpenEngageDatabase } from "@openengage/database";

import {
  nullablePrimitiveString,
  toFiniteNumber,
  parseJsonRecord,
  primitiveString,
} from "../platform/values";

export async function listSegments(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<SegmentRow[]> {
  const rows = await new SegmentRepository(database, workspace).listSegments();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind === "dynamic" ? "dynamic" : "static",
    filterAst: row.filterAst,
    memberCount: row.memberCount,
    evaluatedAt: row.evaluatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

const PREVIEW_LIMIT = 100;

export async function previewSegment(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  filter: SegmentFilter,
): Promise<{ contacts: Contact[]; capped: boolean }> {
  const compiled = compileSegmentFilter(workspace.workspaceId, filter);
  const rows = await new SegmentRepository(database, workspace).previewContacts(
    compiled,
    PREVIEW_LIMIT,
  );
  return {
    contacts: rows.map(toPreviewContact),
    capped: rows.length === PREVIEW_LIMIT,
  };
}

export function toPreviewContact(row: Record<string, unknown>): Contact {
  const rawStatus = primitiveString(row["status"]);
  const status =
    rawStatus === "archived" || rawStatus === "anonymous" ? rawStatus : ("active" as const);
  return {
    id: primitiveString(row["id"]),
    workspaceId: primitiveString(row["workspace_id"]),
    visitorId: nullablePrimitiveString(row["visitor_id"]),
    email: nullablePrimitiveString(row["email"]),
    firstName: nullablePrimitiveString(row["first_name"]),
    lastName: nullablePrimitiveString(row["last_name"]),
    phone: nullablePrimitiveString(row["phone"]),
    externalId: nullablePrimitiveString(row["external_id"]),
    stage: primitiveString(row["stage"]),
    score: toFiniteNumber(row["score"]),
    status,
    archivedAt: nullablePrimitiveString(row["archived_at"]),
    customFields: parseJsonRecord(row["custom_fields"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
  };
}

import { compileSegmentFilter } from "@kaenma/core";
import { SegmentRepository, type KaenmaDatabase } from "@kaenma/database";
import type { Contact, SegmentFilter, SegmentRow, WorkspaceContext } from "@kaenma/orpc";
import { segmentFilterSchema } from "@kaenma/orpc";

import {
  nullablePrimitiveString,
  numericValue,
  parseJsonRecord,
  parseJsonValue,
  primitiveString,
} from "../platform/values";

export async function listSegments(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SegmentRow[]> {
  const rows = await new SegmentRepository(database, workspace).listSegments();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind === "dynamic" ? "dynamic" : "static",
    filterAst: parseFilter(row.filterAst),
    memberCount: row.memberCount,
    evaluatedAt: row.evaluatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function parseFilter(value: string | null): SegmentRow["filterAst"] {
  if (!value) return null;
  const parsed = segmentFilterSchema.safeParse(parseJsonValue<unknown>(value, null));
  return parsed.success ? parsed.data : null;
}

const PREVIEW_LIMIT = 100;

export async function previewSegment(
  database: KaenmaDatabase,
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
    score: numericValue(row["score"]),
    status,
    archivedAt: nullablePrimitiveString(row["archived_at"]),
    customFields: parseJsonRecord(row["custom_fields"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
  };
}

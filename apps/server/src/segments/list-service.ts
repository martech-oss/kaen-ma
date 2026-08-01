import { desc, eq } from "drizzle-orm";

import { compileSegmentFilter } from "@kaenma/core";
import { segments, type KaenmaDatabase } from "@kaenma/database";
import type { SegmentRow } from "@kaenma/orpc";
import type { Contact } from "@kaenma/shared/contacts";
import { segmentFilterSchema, type SegmentFilter } from "@kaenma/shared/segments";

import {
  nullablePrimitiveString,
  numericValue,
  parseJsonRecord,
  parseJsonValue,
  primitiveString,
} from "../values";

export async function listSegments(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<SegmentRow[]> {
  const rows = await database.orm
    .select()
    .from(segments)
    .where(eq(segments.workspaceId, workspaceId))
    .orderBy(desc(segments.updatedAt))
    .limit(200);
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
  workspaceId: string,
  filter: SegmentFilter,
): Promise<{ contacts: Contact[]; capped: boolean }> {
  const compiled = compileSegmentFilter(workspaceId, filter);
  const result = await database
    .prepare(`${compiled.sql} ORDER BY c.id DESC LIMIT ?`)
    .bind(...compiled.params, PREVIEW_LIMIT)
    .all<Record<string, unknown>>();
  return {
    contacts: result.results.map(toPreviewContact),
    capped: result.results.length === PREVIEW_LIMIT,
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

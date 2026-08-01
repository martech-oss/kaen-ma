import { desc, eq } from "drizzle-orm";

import { segments, type KaenmaDatabase } from "@kaenma/database";
import type { SegmentRow } from "@kaenma/orpc";
import { segmentFilterSchema } from "@kaenma/shared/segments";

import { parseJsonValue } from "../values";

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

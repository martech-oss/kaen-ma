import { Hono } from "hono";
import * as z from "zod";

import { compileSegmentFilter } from "@kaenma/core";
import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import { segmentFilterSchema } from "@kaenma/shared/segments";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { listSegments, previewSegment } from "./list-service";

export function registerSegmentRoutes(api: Hono<AppEnvironment>): void {
  api.get("/segments", async (context) => {
    const workspace = context.get("workspace");
    const rows = await listSegments(context.get("database"), workspace.workspaceId);
    return context.json({ data: rows });
  });

  api.post("/segments", requireRole("marketer"), async (context) => {
    const database = context.get("database");
    const schema = z.object({
      name: z.string().trim().min(1).max(191),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      kind: z.enum(["static", "dynamic"]),
      filter: segmentFilterSchema.optional(),
    });
    const parsed = schema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    if (parsed.data.kind === "dynamic" && !parsed.data.filter) {
      return apiError(context, 422, "filter_required", "動的セグメントには条件が必要です");
    }
    const workspace = context.get("workspace");
    const id = uuidv7();
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO segments
       (id, workspace_id, name, slug, kind, filter_ast, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.kind,
        parsed.data.filter ? JSON.stringify(parsed.data.filter) : null,
        now,
        now,
      )
      .run();
    if (parsed.data.kind === "dynamic") {
      await refreshSegmentMemberships(database, workspace.workspaceId, id);
    }
    return context.json({ data: { id, ...parsed.data, createdAt: now, updatedAt: now } }, 201);
  });

  api.post("/segments/:id/refresh", requireRole("marketer"), async (context) => {
    const refreshed = await refreshSegmentMemberships(
      context.get("database"),
      context.get("workspace").workspaceId,
      context.req.param("id"),
    );
    if (!refreshed) {
      return apiError(context, 404, "segment_not_found", "セグメントが見つかりません");
    }
    return context.json({ data: { refreshed: true } });
  });

  api.post("/segments/preview", requireRole("analyst"), async (context) => {
    const parsed = segmentFilterSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const preview = await previewSegment(
      context.get("database"),
      context.get("workspace").workspaceId,
      parsed.data,
    );
    return context.json({
      data: preview.contacts,
      meta: { capped: preview.capped, requestId: context.get("requestId") },
    });
  });
}

export async function updateSegmentMemberCount(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE segments
     SET member_count = (
       SELECT COUNT(*) FROM segment_memberships sm
       WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id
     ), updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
    )
    .bind(new Date().toISOString(), workspaceId, segmentId)
    .run();
}

export async function refreshSegmentMemberships(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
): Promise<boolean> {
  const segment = await database
    .prepare(`SELECT kind, filter_ast FROM segments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, segmentId)
    .first<{ kind: "static" | "dynamic"; filter_ast: string | null }>();
  if (!segment) return false;
  if (segment.kind === "static") {
    await updateSegmentMemberCount(database, workspaceId, segmentId);
    return true;
  }
  let rawFilter: unknown;
  try {
    rawFilter = segment.filter_ast ? JSON.parse(segment.filter_ast) : null;
  } catch {
    return false;
  }
  const parsed = segmentFilterSchema.safeParse(rawFilter);
  if (!parsed.success) return false;
  const compiled = compileSegmentFilter(workspaceId, parsed.data);
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `DELETE FROM segment_memberships
       WHERE workspace_id = ? AND segment_id = ? AND source = 'dynamic'`,
      )
      .bind(workspaceId, segmentId),
    database
      .prepare(
        `INSERT OR IGNORE INTO segment_memberships
       (workspace_id, segment_id, contact_id, source, joined_at)
       SELECT ?, ?, matched.id, 'dynamic', ?
       FROM (${compiled.sql}) matched
       WHERE matched.status != 'archived'`,
      )
      .bind(workspaceId, segmentId, now, ...compiled.params),
    database
      .prepare(
        `UPDATE segments
       SET member_count = (
         SELECT COUNT(*) FROM segment_memberships sm
         WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id
       ), evaluated_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
      )
      .bind(now, now, workspaceId, segmentId),
  ]);
  return true;
}

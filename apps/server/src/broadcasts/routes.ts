import { Hono } from "hono";
import { z } from "zod";

import { uuidv7, type KaenmaDatabase } from "@kaenma/database";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

const broadcastInputSchema = z.object({
  name: z.string().trim().min(1).max(191),
  segmentId: z.string().min(1),
  templateVersionId: z.string().min(1),
  topicId: z.string().min(1).nullable().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
});

export function registerBroadcastRoutes(api: Hono<AppEnvironment>): void {
  api.get("/broadcasts", async (context) => {
    const archived = context.req.query("archived") === "true";
    const result = await context
      .get("database")
      .prepare(
        `SELECT b.id, b.name, b.segment_id, b.template_version_id, b.topic_id,
              b.status, b.scheduled_at, b.started_at, b.completed_at,
              b.archived_at, b.created_at, b.updated_at,
              s.name AS segment_name, s.member_count,
              et.name AS template_name, ev.subject,
              (SELECT COUNT(*) FROM broadcast_recipients br
               WHERE br.workspace_id = b.workspace_id AND br.broadcast_id = b.id)
                AS recipient_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status IN ('accepted', 'delivered')) AS sent_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status = 'delivered') AS delivered_count
       FROM broadcasts b
       JOIN segments s ON s.workspace_id = b.workspace_id AND s.id = b.segment_id
       JOIN email_template_versions ev
         ON ev.workspace_id = b.workspace_id AND ev.id = b.template_version_id
       JOIN email_templates et
         ON et.workspace_id = ev.workspace_id AND et.id = ev.template_id
       WHERE b.workspace_id = ?
         AND ${archived ? "b.archived_at IS NOT NULL" : "b.archived_at IS NULL"}
       ORDER BY b.updated_at DESC LIMIT 200`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.get("/broadcasts/:id", async (context) => {
    const row = await context
      .get("database")
      .prepare(
        `SELECT b.id, b.name, b.segment_id, b.template_version_id, b.topic_id,
              b.status, b.scheduled_at, b.started_at, b.completed_at,
              b.archived_at, b.created_at, b.updated_at,
              s.name AS segment_name, et.name AS template_name, ev.subject,
              (SELECT COUNT(*) FROM broadcast_recipients br
               WHERE br.workspace_id = b.workspace_id AND br.broadcast_id = b.id)
                AS recipient_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status IN ('accepted', 'delivered')) AS sent_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status = 'delivered') AS delivered_count
       FROM broadcasts b
       JOIN segments s ON s.workspace_id = b.workspace_id AND s.id = b.segment_id
       JOIN email_template_versions ev
         ON ev.workspace_id = b.workspace_id AND ev.id = b.template_version_id
       JOIN email_templates et
         ON et.workspace_id = ev.workspace_id AND et.id = ev.template_id
       WHERE b.workspace_id = ? AND b.id = ?`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first();
    return row
      ? context.json({ data: row })
      : apiError(context, 404, "broadcast_not_found", "メールキャンペーンが見つかりません");
  });

  api.post("/broadcasts", requireRole("marketer"), async (context) => {
    const parsed = broadcastInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    if (
      !(await hasValidBroadcastResources(
        context.get("database"),
        workspace.workspaceId,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
      ))
    ) {
      return apiError(
        context,
        422,
        "invalid_broadcast_resources",
        "SegmentまたはMarketingテンプレートが見つかりません",
      );
    }
    const id = uuidv7();
    const now = new Date().toISOString();
    await context
      .get("database")
      .prepare(
        `INSERT INTO broadcasts
       (id, workspace_id, name, segment_id, template_version_id, topic_id,
        status, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
        parsed.data.topicId ?? null,
        parsed.data.scheduledAt ? "scheduled" : "draft",
        parsed.data.scheduledAt ?? null,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.patch("/broadcasts/:id", requireRole("marketer"), async (context) => {
    const parsed = broadcastInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    if (
      !(await hasValidBroadcastResources(
        context.get("database"),
        workspaceId,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
      ))
    ) {
      return apiError(
        context,
        422,
        "invalid_broadcast_resources",
        "SegmentまたはMarketingテンプレートが見つかりません",
      );
    }
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE broadcasts
       SET name = ?, segment_id = ?, template_version_id = ?, topic_id = ?,
           status = ?, scheduled_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL
         AND status IN ('draft', 'scheduled')`,
      )
      .bind(
        parsed.data.name,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
        parsed.data.topicId ?? null,
        parsed.data.scheduledAt ? "scheduled" : "draft",
        parsed.data.scheduledAt ?? null,
        now,
        workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { updated: true } })
      : apiError(
          context,
          409,
          "broadcast_not_editable",
          "送信済みまたはアーカイブ済みのメールキャンペーンは編集できません",
        );
  });

  api.post("/broadcasts/:id/start", requireRole("marketer"), async (context) => {
    const workspace = context.get("workspace");
    if (!context.env.RESEND_API_KEY) {
      return apiError(
        context,
        422,
        "resend_not_configured",
        "RESEND_API_KEY環境変数が設定されていません",
      );
    }
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, ?),
       updated_at = ? WHERE workspace_id = ? AND id = ?
       AND archived_at IS NULL AND status IN ('draft', 'scheduled')`,
      )
      .bind(now, now, workspace.workspaceId, context.req.param("id"))
      .run();
    if (result.meta.changes !== 1) {
      return apiError(
        context,
        409,
        "broadcast_not_startable",
        "Broadcastは既に開始済みか存在しません",
      );
    }
    await context.env.CAMPAIGN_QUEUE.send({
      kind: "broadcast_batch",
      broadcastId: context.req.param("id"),
    });
    return context.json({ data: { started: true } }, 202);
  });

  api.post("/broadcasts/:id/archive", requireRole("marketer"), async (context) => {
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE broadcasts
       SET status = CASE WHEN status IN ('draft', 'scheduled') THEN 'cancelled' ELSE status END,
           archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL
         AND status <> 'sending'`,
      )
      .bind(now, now, context.get("workspace").workspaceId, context.req.param("id"))
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(
          context,
          409,
          "broadcast_not_archivable",
          "送信中のメールキャンペーンはアーカイブできません",
        );
  });
}

export async function hasValidBroadcastResources(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
  templateVersionId: string,
): Promise<boolean> {
  const valid = await database
    .prepare(
      `SELECT s.id
       FROM segments s JOIN email_template_versions ev
         ON ev.id = ? AND ev.workspace_id = s.workspace_id
       JOIN email_templates et
         ON et.id = ev.template_id AND et.workspace_id = ev.workspace_id
       WHERE s.workspace_id = ? AND s.id = ? AND et.purpose = 'marketing'
         AND et.status <> 'archived'`,
    )
    .bind(templateVersionId, workspaceId, segmentId)
    .first();
  return Boolean(valid);
}

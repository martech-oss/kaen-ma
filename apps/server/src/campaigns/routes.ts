import { Hono } from "hono";
import { z } from "zod";

import { validateCampaign } from "@kaenma/core";
import { uuidv7 } from "@kaenma/database";
import { campaignDefinitionSchema, type CampaignDefinition } from "@kaenma/shared";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerCampaignRoutes(api: Hono<AppEnvironment>): void {
  api.get("/campaigns", async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `SELECT id, name, description, status, draft_version_id, published_version_id,
              created_at, updated_at
       FROM campaigns WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
      )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/campaigns", requireRole("marketer"), async (context) => {
    const parsed = campaignDefinitionSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `INSERT INTO campaigns
         (id, workspace_id, name, description, status, draft_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .bind(
          id,
          workspace.workspaceId,
          parsed.data.name,
          parsed.data.description,
          versionId,
          now,
          now,
        ),
      context
        .get("database")
        .prepare(
          `INSERT INTO campaign_versions
         (id, workspace_id, campaign_id, version, status, timezone, graph, created_at)
         VALUES (?, ?, ?, 1, 'draft', ?, ?, ?)`,
        )
        .bind(
          versionId,
          workspace.workspaceId,
          id,
          parsed.data.timezone,
          JSON.stringify(parsed.data),
          now,
        ),
    ]);
    return context.json({ data: { id, draftVersionId: versionId } }, 201);
  });

  api.get("/campaigns/:id/draft", async (context) => {
    const row = await context
      .get("database")
      .prepare(
        `SELECT cv.id, cv.version, cv.graph
       FROM campaigns c
       JOIN campaign_versions cv ON cv.id = c.draft_version_id
        AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ?`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ id: string; version: number; graph: string }>();
    return row
      ? context.json({ data: { ...row, graph: JSON.parse(row.graph) as unknown } })
      : apiError(context, 404, "campaign_not_found", "キャンペーンが見つかりません");
  });

  api.put("/campaigns/:id/draft", requireRole("marketer"), async (context) => {
    const parsed = campaignDefinitionSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context
      .get("database")
      .prepare(
        `UPDATE campaign_versions SET timezone = ?, graph = ?
       WHERE workspace_id = ? AND id = (
         SELECT draft_version_id FROM campaigns WHERE workspace_id = ? AND id = ?
       ) AND status = 'draft'`,
      )
      .bind(
        parsed.data.timezone,
        JSON.stringify(parsed.data),
        context.get("workspace").workspaceId,
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    if (result.meta.changes === 0) {
      return apiError(context, 404, "campaign_not_found", "編集可能な下書きが見つかりません");
    }
    await context
      .get("database")
      .prepare(
        "UPDATE campaigns SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
      )
      .bind(
        parsed.data.name,
        parsed.data.description,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return context.json({ data: { updated: true } });
  });

  api.post("/campaigns/:id/publish", requireRole("marketer"), async (context) => {
    const workspace = context.get("workspace");
    const row = await context
      .get("database")
      .prepare(
        `SELECT c.draft_version_id, cv.version, cv.graph
       FROM campaigns c JOIN campaign_versions cv
         ON cv.id = c.draft_version_id AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND cv.status = 'draft'`,
      )
      .bind(workspace.workspaceId, context.req.param("id"))
      .first<{ draft_version_id: string; version: number; graph: string }>();
    if (!row) return apiError(context, 404, "campaign_not_found", "下書きが見つかりません");
    const parsed = campaignDefinitionSchema.safeParse(JSON.parse(row.graph));
    if (!parsed.success) return validationError(context, parsed.error);
    const validation = validateCampaign(parsed.data);
    if (validation.length > 0) {
      return apiError(context, 422, "invalid_campaign_graph", "公開できないグラフです", validation);
    }
    const nextDraftId = uuidv7();
    const now = new Date().toISOString();
    await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `UPDATE campaign_versions SET status = 'published', published_at = ?
         WHERE workspace_id = ? AND id = ? AND status = 'draft'`,
        )
        .bind(now, workspace.workspaceId, row.draft_version_id),
      context
        .get("database")
        .prepare(
          `INSERT INTO campaign_versions
         (id, workspace_id, campaign_id, version, status, timezone, graph, created_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .bind(
          nextDraftId,
          workspace.workspaceId,
          context.req.param("id"),
          row.version + 1,
          parsed.data.timezone,
          row.graph,
          now,
        ),
      context
        .get("database")
        .prepare(
          `UPDATE campaigns SET status = 'active', published_version_id = ?,
         draft_version_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
        )
        .bind(
          row.draft_version_id,
          nextDraftId,
          now,
          workspace.workspaceId,
          context.req.param("id"),
        ),
    ]);
    return context.json({
      data: { publishedVersionId: row.draft_version_id, draftVersionId: nextDraftId },
    });
  });

  api.post("/campaigns/:id/enroll", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({ contactId: z.string().min(1), sourceEventId: z.string().optional() })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const campaign = await context
      .get("database")
      .prepare(
        `SELECT c.published_version_id, cv.graph
       FROM campaigns c JOIN campaign_versions cv
         ON cv.id = c.published_version_id AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status = 'active'`,
      )
      .bind(workspace.workspaceId, context.req.param("id"))
      .first<{ published_version_id: string; graph: string }>();
    if (!campaign) {
      return apiError(context, 404, "campaign_not_active", "公開中のキャンペーンがありません");
    }
    const graph = JSON.parse(campaign.graph) as CampaignDefinition;
    const source = graph.nodes.find((node) => node.type === "source");
    if (!source) return apiError(context, 422, "source_missing", "Sourceノードがありません");
    const enrollmentId = uuidv7();
    const jobId = uuidv7();
    const sourceEventId =
      parsed.data.sourceEventId ?? context.req.header("idempotency-key") ?? uuidv7();
    const now = new Date().toISOString();
    try {
      await context.get("database").batch([
        context
          .get("database")
          .prepare(
            `INSERT INTO campaign_enrollments
           (id, workspace_id, campaign_id, campaign_version_id, contact_id,
            source_event_id, status, current_node_id, entered_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          )
          .bind(
            enrollmentId,
            workspace.workspaceId,
            context.req.param("id"),
            campaign.published_version_id,
            parsed.data.contactId,
            sourceEventId,
            source.id,
            now,
            now,
          ),
        context
          .get("database")
          .prepare(
            `INSERT INTO campaign_jobs
           (id, workspace_id, enrollment_id, campaign_version_id, node_id,
            recipient_id, idempotency_key, status, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          )
          .bind(
            jobId,
            workspace.workspaceId,
            enrollmentId,
            campaign.published_version_id,
            source.id,
            parsed.data.contactId,
            `${enrollmentId}:${source.id}:${parsed.data.contactId}`,
            now,
            now,
            now,
          ),
      ]);
    } catch (error) {
      return apiError(
        context,
        409,
        "already_enrolled",
        "このイベントでは既に参加済みです",
        error instanceof Error ? error.message : undefined,
      );
    }
    return context.json({ data: { enrollmentId, jobId } }, 202);
  });
}

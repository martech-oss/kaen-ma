import { Hono } from "hono";
import * as z from "zod";

import { validateCampaign } from "@kaenma/core";
import { uuidv7 } from "@kaenma/database";
import { campaignDefinitionSchema, type CampaignDefinition } from "@kaenma/shared";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { enrollPublishedCampaign } from "./enrollment";
import { listCampaigns } from "./list-service";

export function registerCampaignRoutes(api: Hono<AppEnvironment>): void {
  api.get("/campaigns", async (context) => {
    const rows = await listCampaigns(context.get("database"), context.get("workspace").workspaceId);
    return context.json({ data: rows });
  });

  api.post("/campaigns", requireRole("marketer"), async (context) => {
    const database = context.get("database");
    const parsed = campaignDefinitionSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await database.batch([
      database
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
      database
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
        `SELECT cv.id, cv.version, cv.graph, c.status
       FROM campaigns c
       JOIN campaign_versions cv ON cv.id = c.draft_version_id
        AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ?`,
      )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ id: string; version: number; graph: string; status: string }>();
    return row
      ? context.json({ data: { ...row, graph: JSON.parse(row.graph) as unknown } })
      : apiError(context, 404, "campaign_not_found", "キャンペーンが見つかりません");
  });

  api.put("/campaigns/:id/draft", requireRole("marketer"), async (context) => {
    const database = context.get("database");
    const parsed = campaignDefinitionSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await database
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
    await database
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
    const database = context.get("database");
    const workspace = context.get("workspace");
    const row = await database
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
    const templateIds = [
      ...new Set(
        parsed.data.nodes.flatMap((node) =>
          node.type === "action" && node.config.action === "send_email"
            ? [node.config.templateId]
            : [],
        ),
      ),
    ];
    if (templateIds.length > 0) {
      const available = await database
        .prepare(
          `SELECT id FROM email_templates
           WHERE workspace_id = ? AND archived_at IS NULL
             AND remote_status = 'published' AND sync_error IS NULL
             AND id IN (${templateIds.map(() => "?").join(", ")})`,
        )
        .bind(workspace.workspaceId, ...templateIds)
        .all<{ id: string }>();
      const availableIds = new Set(available.results.map((template) => template.id));
      const unavailableIds = templateIds.filter((id) => !availableIds.has(id));
      if (unavailableIds.length > 0) {
        return apiError(
          context,
          422,
          "campaign_email_template_unavailable",
          "公開済みのResend Templateへ同期されていないメールノードがあります",
          { templateIds: unavailableIds },
        );
      }
    }
    const nextDraftId = uuidv7();
    const now = new Date().toISOString();
    const source = parsed.data.nodes.find((node) => node.type === "source");
    if (!source) return apiError(context, 422, "source_missing", "開始条件がありません");
    const trigger = campaignTrigger(source.config);
    await database.batch([
      database
        .prepare(
          `UPDATE campaign_versions SET status = 'published', published_at = ?
         WHERE workspace_id = ? AND id = ? AND status = 'draft'`,
        )
        .bind(now, workspace.workspaceId, row.draft_version_id),
      database
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
      database
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
      database
        .prepare("DELETE FROM campaign_triggers WHERE workspace_id = ? AND campaign_id = ?")
        .bind(workspace.workspaceId, context.req.param("id")),
      database
        .prepare(
          `INSERT INTO campaign_triggers
           (campaign_version_id, workspace_id, campaign_id, source_node_id, source,
            event_type, resource_id, reentry, inactivity_days, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.draft_version_id,
          workspace.workspaceId,
          context.req.param("id"),
          source.id,
          source.config.source,
          trigger.eventType,
          trigger.resourceId,
          source.config.reentry,
          trigger.inactivityDays,
          now,
        ),
    ]);
    return context.json({
      data: { publishedVersionId: row.draft_version_id, draftVersionId: nextDraftId },
    });
  });

  api.post("/campaigns/:id/enroll", requireRole("marketer"), async (context) => {
    const database = context.get("database");
    const parsed = z
      .object({ contactId: z.string().min(1), sourceEventId: z.string().optional() })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const campaign = await database
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
    const sourceEventId =
      parsed.data.sourceEventId ?? context.req.header("idempotency-key") ?? uuidv7();
    const result = await enrollPublishedCampaign(database, {
      workspaceId: workspace.workspaceId,
      campaignId: context.req.param("id"),
      campaignVersionId: campaign.published_version_id,
      contactId: parsed.data.contactId,
      sourceNodeId: source.id,
      sourceEventId,
    });
    if (!result) {
      return apiError(context, 409, "already_enrolled", "このイベントでは既に参加済みです");
    }
    return context.json({ data: result }, 202);
  });

  api.post("/campaigns/:id/status", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({ status: z.enum(["active", "paused"]) })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context
      .get("database")
      .prepare(
        `UPDATE campaigns SET status = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND published_version_id IS NOT NULL
           AND status IN ('active', 'paused')`,
      )
      .bind(
        parsed.data.status,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { status: parsed.data.status } })
      : apiError(context, 409, "campaign_status_not_changeable", "公開済みフローがありません");
  });
}

export function campaignTrigger(
  config: Extract<CampaignDefinition["nodes"][number], { type: "source" }>["config"],
): { eventType: string | null; resourceId: string | null; inactivityDays: number | null } {
  switch (config.source) {
    case "contact_created":
      return { eventType: "contact_created", resourceId: null, inactivityDays: null };
    case "segment_joined":
      return { eventType: "segment_joined", resourceId: config.segmentId, inactivityDays: null };
    case "form_submitted":
      return { eventType: "form_submitted", resourceId: config.formId, inactivityDays: null };
    case "api_event":
      return { eventType: "custom_event", resourceId: config.eventName, inactivityDays: null };
    case "webhook_event":
      return { eventType: "webhook_event", resourceId: config.eventName, inactivityDays: null };
    case "contact_inactive":
      return { eventType: null, resourceId: null, inactivityDays: config.days };
  }
}

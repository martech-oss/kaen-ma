import { validateCampaign } from "@kaenma/core";
import { uuidv7 } from "@kaenma/database";
import { campaignDefinitionSchema, type CampaignDefinition } from "@kaenma/shared";

import { hasWorkspaceRole } from "../auth/authorization";
import { authed } from "../orpc/base";
import { isRecord } from "../values";
import { getCampaignAnalytics } from "./analytics-service";
import { enrollContactManually } from "./enrollment";
import { listCampaigns, normalizeCampaignStatus } from "./list-service";
import { campaignTrigger } from "./triggers";

export const listCampaignsProcedure = authed.campaigns.list.handler(async ({ context }) => {
  return listCampaigns(context.database, context.workspace.workspaceId);
});

export const createCampaignProcedure = authed.campaigns.create.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.database.batch([
      context.database
        .prepare(
          `INSERT INTO campaigns
           (id, workspace_id, name, description, status, draft_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .bind(
          id,
          context.workspace.workspaceId,
          input.name,
          input.description,
          versionId,
          now,
          now,
        ),
      context.database
        .prepare(
          `INSERT INTO campaign_versions
           (id, workspace_id, campaign_id, version, status, timezone, graph, created_at)
           VALUES (?, ?, ?, 1, 'draft', ?, ?, ?)`,
        )
        .bind(
          versionId,
          context.workspace.workspaceId,
          id,
          input.timezone,
          JSON.stringify(input),
          now,
        ),
    ]);
    return { id, draftVersionId: versionId };
  },
);

export const getCampaignDraftProcedure = authed.campaigns.getDraft.handler(
  async ({ context, input, errors }) => {
    const row = await context.database
      .prepare(
        `SELECT cv.graph, c.status
         FROM campaigns c
         JOIN campaign_versions cv ON cv.id = c.draft_version_id
          AND cv.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.id = ?`,
      )
      .bind(context.workspace.workspaceId, input.id)
      .first<{ graph: string; status: string }>();
    if (!row) throw errors.CAMPAIGN_NOT_FOUND();
    const graph = campaignDefinitionSchema.safeParse(JSON.parse(row.graph));
    if (!graph.success) throw errors.CAMPAIGN_NOT_FOUND();
    return { graph: graph.data, status: normalizeCampaignStatus(row.status) };
  },
);

export const saveCampaignDraftProcedure = authed.campaigns.saveDraft.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const { id, ...definition } = input;
    const workspaceId = context.workspace.workspaceId;
    const result = await context.database
      .prepare(
        `UPDATE campaign_versions SET timezone = ?, graph = ?
         WHERE workspace_id = ? AND id = (
           SELECT draft_version_id FROM campaigns WHERE workspace_id = ? AND id = ?
         ) AND status = 'draft'`,
      )
      .bind(definition.timezone, JSON.stringify(definition), workspaceId, workspaceId, id)
      .run();
    if (result.meta.changes === 0) throw errors.DRAFT_NOT_EDITABLE();
    await context.database
      .prepare(
        `UPDATE campaigns SET name = ?, description = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .bind(definition.name, definition.description, new Date().toISOString(), workspaceId, id)
      .run();
    return { updated: true as const };
  },
);

export const publishCampaignProcedure = authed.campaigns.publish.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const database = context.database;
    const workspaceId = context.workspace.workspaceId;
    const row = await database
      .prepare(
        `SELECT c.draft_version_id, cv.version, cv.graph
         FROM campaigns c JOIN campaign_versions cv
           ON cv.id = c.draft_version_id AND cv.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.id = ? AND cv.status = 'draft'`,
      )
      .bind(workspaceId, input.id)
      .first<{ draft_version_id: string; version: number; graph: string }>();
    if (!row) throw errors.DRAFT_NOT_FOUND();

    const parsed = campaignDefinitionSchema.safeParse(JSON.parse(row.graph));
    if (!parsed.success) throw errors.INVALID_GRAPH({ message: "フロー定義が不正です" });
    const definition: CampaignDefinition = parsed.data;
    const validation = validateCampaign(definition);
    if (validation.length > 0) {
      throw errors.INVALID_GRAPH({ data: { issues: validation } });
    }

    const templateIds = [
      ...new Set(
        definition.nodes.flatMap((node) =>
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
        .bind(workspaceId, ...templateIds)
        .all<{ id: string }>();
      const availableIds = new Set(available.results.map((template) => template.id));
      const unavailableIds = templateIds.filter((templateId) => !availableIds.has(templateId));
      if (unavailableIds.length > 0) {
        throw errors.INVALID_GRAPH({
          message: "公開済みのResend Templateへ同期されていないメールノードがあります",
          data: { templateIds: unavailableIds },
        });
      }
    }

    const source = definition.nodes.find((node) => node.type === "source");
    if (!source) throw errors.INVALID_GRAPH({ message: "開始条件がありません" });
    const trigger = campaignTrigger(source.config);
    const nextDraftId = uuidv7();
    const now = new Date().toISOString();
    await database.batch([
      database
        .prepare(
          `UPDATE campaign_versions SET status = 'published', published_at = ?
           WHERE workspace_id = ? AND id = ? AND status = 'draft'`,
        )
        .bind(now, workspaceId, row.draft_version_id),
      database
        .prepare(
          `INSERT INTO campaign_versions
           (id, workspace_id, campaign_id, version, status, timezone, graph, created_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        )
        .bind(
          nextDraftId,
          workspaceId,
          input.id,
          row.version + 1,
          definition.timezone,
          row.graph,
          now,
        ),
      database
        .prepare(
          `UPDATE campaigns SET status = 'active', published_version_id = ?,
           draft_version_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
        )
        .bind(row.draft_version_id, nextDraftId, now, workspaceId, input.id),
      database
        .prepare("DELETE FROM campaign_triggers WHERE workspace_id = ? AND campaign_id = ?")
        .bind(workspaceId, input.id),
      database
        .prepare(
          `INSERT INTO campaign_triggers
           (campaign_version_id, workspace_id, campaign_id, source_node_id, source,
            event_type, resource_id, reentry, inactivity_days, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.draft_version_id,
          workspaceId,
          input.id,
          source.id,
          source.config.source,
          trigger.eventType,
          trigger.resourceId,
          source.config.reentry,
          trigger.inactivityDays,
          now,
        ),
    ]);
    return { publishedVersionId: row.draft_version_id, draftVersionId: nextDraftId };
  },
);

export const setCampaignStatusProcedure = authed.campaigns.setStatus.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const result = await context.database
      .prepare(
        `UPDATE campaigns SET status = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND published_version_id IS NOT NULL
           AND status IN ('active', 'paused')`,
      )
      .bind(input.status, new Date().toISOString(), context.workspace.workspaceId, input.id)
      .run();
    if (result.meta.changes !== 1) throw errors.NOT_CHANGEABLE();
    return { status: input.status };
  },
);

export const enrollCampaignProcedure = authed.campaigns.enroll.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const outcome = await enrollContactManually(context.database, {
      workspaceId: context.workspace.workspaceId,
      campaignId: input.id,
      contactId: input.contactId,
      sourceEventId: input.sourceEventId ?? uuidv7(),
    });
    switch (outcome.kind) {
      case "not_active":
        throw errors.CAMPAIGN_NOT_ACTIVE();
      case "source_missing":
        throw errors.SOURCE_MISSING();
      case "already_enrolled":
        throw errors.ALREADY_ENROLLED();
      case "enrolled":
        return outcome.result;
    }
  },
);

export const campaignAnalyticsProcedure = authed.campaigns.analytics.handler(
  async ({ context, input }) =>
    getCampaignAnalytics(context.database, context.workspace.workspaceId, input.id),
);

// isRecord is re-exported for the client-side error shape check in tests.
export { isRecord };

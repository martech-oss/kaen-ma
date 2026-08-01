import { validateCampaign } from "@kaenma/core";
import { CampaignRepository, uuidv7 } from "@kaenma/database";
import { campaignDefinitionSchema, type CampaignDefinition } from "@kaenma/orpc";

import { authed, requireRole } from "../orpc/base";
import { isRecord } from "../platform/values";
import { getCampaignAnalytics } from "./analytics-service";
import { enrollContactManually } from "./enrollment";
import { listCampaigns, normalizeCampaignStatus } from "./list-service";
import { campaignTrigger } from "./triggers";

export const listCampaignsProcedure = authed.campaigns.list.handler(async ({ context }) => {
  return listCampaigns(context.database, context.workspace.workspaceId);
});

export const createCampaignProcedure = authed.campaigns.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new CampaignRepository(context.database, context.workspace);
    const created = await repository.createCampaign({
      name: input.name,
      description: input.description,
      timezone: input.timezone,
      graph: JSON.stringify(input),
    });
    return { id: created.id, draftVersionId: created.draftVersionId };
  },
);

export const getCampaignDraftProcedure = authed.campaigns.getDraft.handler(
  async ({ context, input, errors }) => {
    const repository = new CampaignRepository(context.database, context.workspace);
    const row = await repository.getDraft(input.id);
    if (!row) throw errors.CAMPAIGN_NOT_FOUND();
    const graph = campaignDefinitionSchema.safeParse(JSON.parse(row.graph));
    if (!graph.success) throw errors.CAMPAIGN_NOT_FOUND();
    return { graph: graph.data, status: normalizeCampaignStatus(row.status) };
  },
);

export const saveCampaignDraftProcedure = authed.campaigns.saveDraft.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...definition } = input;
    const repository = new CampaignRepository(context.database, context.workspace);
    const updated = await repository.saveDraft(id, {
      name: definition.name,
      description: definition.description,
      timezone: definition.timezone,
      graph: JSON.stringify(definition),
    });
    if (!updated) throw errors.DRAFT_NOT_EDITABLE();
    return { updated: true as const };
  },
);

export const publishCampaignProcedure = authed.campaigns.publish.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new CampaignRepository(context.database, context.workspace);
    const row = await repository.findPublishableDraft(input.id);
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
      const availableIds = new Set(await repository.listPublishedTemplateIds(templateIds));
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
    const published = await repository.publishDraft({
      campaignId: input.id,
      draftVersionId: row.draftVersionId,
      currentVersion: row.version,
      timezone: definition.timezone,
      graph: row.graph,
      trigger: {
        sourceNodeId: source.id,
        source: source.config.source,
        eventType: trigger.eventType,
        resourceId: trigger.resourceId,
        reentry: source.config.reentry,
        inactivityDays: trigger.inactivityDays,
      },
    });
    return { publishedVersionId: row.draftVersionId, draftVersionId: published.draftVersionId };
  },
);

export const setCampaignStatusProcedure = authed.campaigns.setStatus.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new CampaignRepository(context.database, context.workspace);
    const changed = await repository.setCampaignStatus(input.id, input.status);
    if (!changed) throw errors.NOT_CHANGEABLE();
    return { status: input.status };
  },
);

export const enrollCampaignProcedure = authed.campaigns.enroll.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
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

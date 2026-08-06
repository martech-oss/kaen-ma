import { validateAutomation } from "@openengage/core";
import type { AutomationDefinition } from "@openengage/core/automations";
import { AutomationRepository, uuidv7 } from "@openengage/database";

import { authed, requireRole } from "../orpc/base";
import { isRecord } from "../platform/values";
import { getAutomationAnalytics } from "./analytics-service";
import { enrollContactManually } from "./enrollment";
import { listAutomations, normalizeAutomationStatus } from "./list-service";
import { automationTrigger } from "./triggers";

export const listAutomationsProcedure = authed.automations.list.handler(async ({ context }) => {
  return listAutomations(context.database, context.workspace.workspaceId);
});

export const createAutomationProcedure = authed.automations.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new AutomationRepository(context.database, context.workspace);
    const created = await repository.createAutomation({
      name: input.name,
      description: input.description,
      timezone: input.timezone,
      graph: input,
    });
    return { id: created.id, draftVersionId: created.draftVersionId };
  },
);

export const getAutomationDraftProcedure = authed.automations.getDraft.handler(
  async ({ context, input, errors }) => {
    const repository = new AutomationRepository(context.database, context.workspace);
    const row = await repository.getDraft(input.id);
    if (!row) throw errors.AUTOMATION_NOT_FOUND();
    return { graph: row.graph, status: normalizeAutomationStatus(row.status) };
  },
);

export const saveAutomationDraftProcedure = authed.automations.saveDraft.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...definition } = input;
    const repository = new AutomationRepository(context.database, context.workspace);
    const updated = await repository.saveDraft(id, {
      name: definition.name,
      description: definition.description,
      timezone: definition.timezone,
      graph: definition,
    });
    if (!updated) throw errors.DRAFT_NOT_EDITABLE();
    return { updated: true as const };
  },
);

export const publishAutomationProcedure = authed.automations.publish.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new AutomationRepository(context.database, context.workspace);
    const row = await repository.findPublishableDraft(input.id);
    if (!row) throw errors.DRAFT_NOT_FOUND();

    const definition: AutomationDefinition = row.graph;
    const validation = validateAutomation(definition);
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
          message: "公開済みのTransactionalテンプレートを参照していないメールノードがあります",
          data: { templateIds: unavailableIds },
        });
      }
    }

    const source = definition.nodes.find((node) => node.type === "source");
    if (!source) throw errors.INVALID_GRAPH({ message: "開始条件がありません" });
    const trigger = automationTrigger(source.config);
    const published = await repository.publishDraft({
      automationId: input.id,
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

export const setAutomationStatusProcedure = authed.automations.setStatus.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const repository = new AutomationRepository(context.database, context.workspace);
    const changed = await repository.setAutomationStatus(input.id, input.status);
    if (!changed) throw errors.NOT_CHANGEABLE();
    return { status: input.status };
  },
);

export const enrollAutomationProcedure = authed.automations.enroll.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await enrollContactManually(context.database, {
      workspaceId: context.workspace.workspaceId,
      automationId: input.id,
      contactId: input.contactId,
      sourceEventId: input.sourceEventId ?? uuidv7(),
    });
    switch (outcome.kind) {
      case "not_active":
        throw errors.AUTOMATION_NOT_ACTIVE();
      case "source_missing":
        throw errors.SOURCE_MISSING();
      case "already_enrolled":
        throw errors.ALREADY_ENROLLED();
      case "enrolled":
        return outcome.result;
    }
  },
);

export const automationAnalyticsProcedure = authed.automations.analytics.handler(
  async ({ context, input }) =>
    getAutomationAnalytics(context.database, context.workspace.workspaceId, input.id),
);

export const automationProcedures = {
  list: listAutomationsProcedure,
  create: createAutomationProcedure,
  getDraft: getAutomationDraftProcedure,
  saveDraft: saveAutomationDraftProcedure,
  publish: publishAutomationProcedure,
  setStatus: setAutomationStatusProcedure,
  enroll: enrollAutomationProcedure,
  analytics: automationAnalyticsProcedure,
};

// isRecord is re-exported for the client-side error shape check in tests.
export { isRecord };

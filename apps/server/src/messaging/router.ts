import { authed, requireRole } from "../orpc/base";
import {
  archiveEmailCampaign,
  archiveEmailTemplate,
  archiveMessageVariable,
  createEmailCampaign,
  createMessageVariable,
  getEmailCampaign,
  importEmailTemplate,
  listBroadcastSegmentOptions,
  listEmailCampaigns,
  listEmailTemplates,
  listMessageVariables,
  listSubscriptionTopicOptions,
  RemoteTemplateError,
  startEmailCampaign,
  syncEmailTemplate,
  TemplateAlreadyRegisteredError,
  updateEmailCampaign,
  updateMessageVariable,
  VariableConflictError,
} from "./service";

export const listEmailCampaignsProcedure = authed.emails.listCampaigns.handler(
  ({ context, input }) => listEmailCampaigns(context.database, context.workspace, input.archived),
);

export const getEmailCampaignProcedure = authed.emails.getCampaign.handler(
  async ({ context, input, errors }) => {
    const campaign = await getEmailCampaign(context.database, context.workspace, input.id);
    if (!campaign) throw errors.BROADCAST_NOT_FOUND();
    return campaign;
  },
);

export const createEmailCampaignProcedure = authed.emails.createCampaign.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await createEmailCampaign(context.database, context.workspace, input);
    if (outcome.kind === "invalid_resources") throw errors.INVALID_BROADCAST_RESOURCES();
    return { id: outcome.id };
  },
);

export const updateEmailCampaignProcedure = authed.emails.updateCampaign.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const outcome = await updateEmailCampaign(context.database, context.workspace, id, changes);
    if (outcome.kind === "invalid_resources") throw errors.INVALID_BROADCAST_RESOURCES();
    if (outcome.kind === "not_editable") throw errors.NOT_EDITABLE();
    return { updated: true as const };
  },
);

export const startEmailCampaignProcedure = authed.emails.startCampaign.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await startEmailCampaign(
      context.database,
      context.workspace,
      context.env,
      input.id,
    );
    if (outcome === "not_configured") throw errors.RESEND_NOT_CONFIGURED();
    if (outcome === "not_startable") throw errors.NOT_STARTABLE();
    return { started: true as const };
  },
);

export const archiveEmailCampaignProcedure = authed.emails.archiveCampaign.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await archiveEmailCampaign(context.database, context.workspace, input.id))) {
      throw errors.NOT_ARCHIVABLE();
    }
    return { archived: true as const };
  },
);

export const listTemplatesProcedure = authed.emails.listTemplates.handler(({ context, input }) =>
  listEmailTemplates(context.database, context.workspace, input.archived),
);

export const importTemplateProcedure = authed.emails.importTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await importEmailTemplate(context.database, context.workspace, context.env, input);
    } catch (error) {
      if (error instanceof TemplateAlreadyRegisteredError) throw errors.ALREADY_REGISTERED();
      if (error instanceof RemoteTemplateError) {
        throw error.transient
          ? errors.REMOTE_TEMPORARILY_UNAVAILABLE({ message: error.message })
          : errors.REMOTE_TEMPLATE_UNAVAILABLE({ message: error.message });
      }
      throw error;
    }
  },
);

export const syncTemplateProcedure = authed.emails.syncTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      if (!(await syncEmailTemplate(context.database, context.workspace, context.env, input.id))) {
        throw errors.NOT_FOUND();
      }
    } catch (error) {
      if (error instanceof RemoteTemplateError) {
        throw error.transient
          ? errors.REMOTE_TEMPORARILY_UNAVAILABLE({ message: error.message })
          : errors.REMOTE_TEMPLATE_UNAVAILABLE({ message: error.message });
      }
      throw error;
    }
    return { synced: true as const };
  },
);

export const archiveTemplateProcedure = authed.emails.archiveTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await archiveEmailTemplate(context.database, context.workspace, input.id))) {
      throw errors.NOT_FOUND();
    }
    return { archived: true as const };
  },
);

export const listVariablesProcedure = authed.emails.listVariables.handler(({ context, input }) =>
  listMessageVariables(context.database, context.workspace, input.archived),
);

export const createVariableProcedure = authed.emails.createVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createMessageVariable(context.database, context.workspace, input);
    } catch (error) {
      if (error instanceof VariableConflictError) throw errors.VARIABLE_CONFLICT();
      throw error;
    }
  },
);

export const updateVariableProcedure = authed.emails.updateVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    try {
      if (!(await updateMessageVariable(context.database, context.workspace, id, changes))) {
        throw errors.NOT_FOUND();
      }
    } catch (error) {
      if (error instanceof VariableConflictError) throw errors.VARIABLE_CONFLICT();
      throw error;
    }
    return { updated: true as const };
  },
);

export const archiveVariableProcedure = authed.emails.archiveVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await archiveMessageVariable(context.database, context.workspace, input.id))) {
      throw errors.NOT_FOUND();
    }
    return { archived: true as const };
  },
);

export const listSegmentOptionsProcedure = authed.emails.listSegmentOptions.handler(({ context }) =>
  listBroadcastSegmentOptions(context.database, context.workspace),
);

export const listTopicOptionsProcedure = authed.emails.listTopicOptions.handler(({ context }) =>
  listSubscriptionTopicOptions(context.database, context.workspace),
);

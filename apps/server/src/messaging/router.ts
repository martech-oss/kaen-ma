import { authed, requireRole } from "../orpc/base";
import {
  archiveEmailTemplate,
  archiveMessageVariable,
  createEmailTemplate,
  createMessageVariable,
  listEmailSegmentOptions,
  listEmailTemplates,
  listMessageVariables,
  listSubscriptionTopicOptions,
  previewEmailTemplate,
  publishEmailTemplate,
  updateEmailTemplate,
  updateMessageVariable,
  VariableConflictError,
} from "./service";

export const listTemplatesProcedure = authed.emails.listTemplates.handler(({ context, input }) =>
  listEmailTemplates(context.database, context.workspace, input.archived),
);

export const createTemplateProcedure = authed.emails.createTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return await createEmailTemplate(context.database, context.workspace, input);
  },
);

export const updateTemplateProcedure = authed.emails.updateTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    if (!(await updateEmailTemplate(context.database, context.workspace, id, changes))) {
      throw errors.NOT_FOUND();
    }
    return { updated: true as const };
  },
);

export const previewTemplateProcedure = authed.emails.previewTemplate.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return previewEmailTemplate(input);
  },
);

export const publishTemplateProcedure = authed.emails.publishTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await publishEmailTemplate(context.database, context.workspace, input.id))) {
      throw errors.NOT_FOUND();
    }
    return { published: true as const };
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
  listEmailSegmentOptions(context.database, context.workspace),
);

export const listTopicOptionsProcedure = authed.emails.listTopicOptions.handler(({ context }) =>
  listSubscriptionTopicOptions(context.database, context.workspace),
);

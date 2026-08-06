import { MessagingRepository } from "@openengage/database";
import { ack } from "@openengage/orpc";

import { authed, requireRole } from "../orpc/base";
import { previewEmailTemplate } from "../rendering/content-renderer";
import {
  archiveMessageVariable,
  createMessageVariable,
  listEmailSegmentOptions,
  listMessageVariables,
  listSubscriptionTopicOptions,
  updateMessageVariable,
  VariableConflictError,
} from "./service";

export const listTemplatesProcedure = authed.emails.listTemplates.handler(({ context, input }) =>
  new MessagingRepository(context.database, context.workspace).listEmailTemplates(input.archived),
);

export const createTemplateProcedure = authed.emails.createTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return new MessagingRepository(context.database, context.workspace).createEmailTemplate(input);
  },
);

export const updateTemplateProcedure = authed.emails.updateTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const repository = new MessagingRepository(context.database, context.workspace);
    if (!(await repository.updateEmailTemplate(id, changes))) {
      throw errors.TEMPLATE_NOT_FOUND();
    }
    return ack;
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
    const repository = new MessagingRepository(context.database, context.workspace);
    if (!(await repository.publishEmailTemplate(input.id))) {
      throw errors.TEMPLATE_NOT_FOUND();
    }
    return ack;
  },
);

export const archiveTemplateProcedure = authed.emails.archiveTemplate.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    const repository = new MessagingRepository(context.database, context.workspace);
    if (!(await repository.archiveEmailTemplate(input.id))) {
      throw errors.TEMPLATE_NOT_FOUND();
    }
    return ack;
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
        throw errors.MESSAGE_VARIABLE_NOT_FOUND();
      }
    } catch (error) {
      if (error instanceof VariableConflictError) throw errors.VARIABLE_CONFLICT();
      throw error;
    }
    return ack;
  },
);

export const archiveVariableProcedure = authed.emails.archiveVariable.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await archiveMessageVariable(context.database, context.workspace, input.id))) {
      throw errors.MESSAGE_VARIABLE_NOT_FOUND();
    }
    return ack;
  },
);

export const listSegmentOptionsProcedure = authed.emails.listSegmentOptions.handler(({ context }) =>
  listEmailSegmentOptions(context.database, context.workspace),
);

export const listTopicOptionsProcedure = authed.emails.listTopicOptions.handler(({ context }) =>
  listSubscriptionTopicOptions(context.database, context.workspace),
);

export const messagingProcedures = {
  listTemplates: listTemplatesProcedure,
  createTemplate: createTemplateProcedure,
  updateTemplate: updateTemplateProcedure,
  previewTemplate: previewTemplateProcedure,
  publishTemplate: publishTemplateProcedure,
  archiveTemplate: archiveTemplateProcedure,
  listVariables: listVariablesProcedure,
  createVariable: createVariableProcedure,
  updateVariable: updateVariableProcedure,
  archiveVariable: archiveVariableProcedure,
  listSegmentOptions: listSegmentOptionsProcedure,
  listTopicOptions: listTopicOptionsProcedure,
};

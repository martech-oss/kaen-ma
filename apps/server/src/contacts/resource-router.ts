import { authed, requireRole } from "../orpc/base";
import {
  addContactSegment,
  addContactTag,
  adjustContactScore,
  applyContactBulkAction,
  createTag,
  getContactOptions,
  getContactProfile,
  removeContactSegment,
  removeContactTag,
  ResourceConflictError,
  restoreContact,
} from "./resource-service";

export const contactOptionsProcedure = authed.contactResources.options.handler(({ context }) =>
  getContactOptions(context.database, context.workspace),
);

export const contactProfileProcedure = authed.contactResources.profile.handler(
  async ({ context, input, errors }) => {
    const profile = await getContactProfile(context.database, context.workspace, input.contactId);
    if (!profile) throw errors.CONTACT_NOT_FOUND();
    return profile;
  },
);

export const createTagProcedure = authed.contactResources.createTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    try {
      return await createTag(context.database, context.workspace, input);
    } catch (error) {
      if (error instanceof ResourceConflictError) throw errors.TAG_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const addTagProcedure = authed.contactResources.addTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await addContactTag(context.database, context.workspace, input))) {
      throw errors.RELATION_REJECTED();
    }
    return { assigned: true as const };
  },
);

export const removeTagProcedure = authed.contactResources.removeTag.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await removeContactTag(context.database, context.workspace, input))) {
      throw errors.RELATION_REJECTED();
    }
    return { removed: true as const };
  },
);

export const addSegmentProcedure = authed.contactResources.addSegment.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (!(await addContactSegment(context.database, context.workspace, input))) {
      throw errors.RELATION_REJECTED();
    }
    return { assigned: true as const };
  },
);

// Mirrors the REST route, which reports success even when nothing matched.
export const removeSegmentProcedure = authed.contactResources.removeSegment.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    await removeContactSegment(context.database, context.workspace, input);
    return { removed: true as const };
  },
);

export const adjustScoreProcedure = authed.contactResources.adjustScore.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { contactId, ...adjustment } = input;
    const contact = await adjustContactScore(
      context.database,
      context.workspace,
      contactId,
      adjustment,
    );
    if (!contact) throw errors.SCORE_NOT_ADJUSTABLE();
    return contact;
  },
);

export const restoreContactProcedure = authed.contactResources.restore.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await restoreContact(context.database, context.workspace, input.contactId))) {
      throw errors.CONTACT_NOT_ARCHIVED();
    }
    return { restored: true as const };
  },
);

export const bulkActionProcedure = authed.contactResources.bulkAction.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await applyContactBulkAction(context.database, context.workspace, input);
    if (outcome.kind === "archive_forbidden") throw errors.ARCHIVE_FORBIDDEN();
    if (outcome.kind === "resource_required") throw errors.RESOURCE_REQUIRED();
    return { updated: outcome.updated };
  },
);

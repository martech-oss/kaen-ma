import { authed, requireRole } from "../orpc/base";
import { isValidDomain, normalizeDomain } from "../public/domain";
import {
  archiveLandingPage,
  archiveSignupForm,
  archiveSiteMessage,
  createLandingPage,
  createSignupForm,
  createSiteMessage,
  getSiteTracking,
  listLandingPages,
  listSignupForms,
  listSiteMessages,
  saveSiteTracking,
  updateLandingPage,
  updateSignupForm,
  updateSiteMessage,
} from "./service";

export const listFormsProcedure = authed.website.listForms.handler(({ context }) =>
  listSignupForms(context.database, context.workspace),
);

export const createFormProcedure = authed.website.createForm.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return createSignupForm(context.database, context.workspace, input);
  },
);

export const updateFormProcedure = authed.website.updateForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    if (!(await updateSignupForm(context.database, context.workspace, id, changes))) {
      throw errors.NOT_FOUND();
    }
    return { id };
  },
);

export const archiveFormProcedure = authed.website.archiveForm.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await archiveSignupForm(context.database, context.workspace, input.id))) {
      throw errors.NOT_FOUND();
    }
    return { archived: true as const };
  },
);

export const listPagesProcedure = authed.website.listPages.handler(({ context }) =>
  listLandingPages(context.database, context.workspace),
);

export const createPageProcedure = authed.website.createPage.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return createLandingPage(context.database, context.workspace, input);
  },
);

export const updatePageProcedure = authed.website.updatePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    const outcome = await updateLandingPage(context.database, context.workspace, id, changes);
    if (outcome.kind === "not_found") throw errors.NOT_FOUND();
    if (outcome.kind === "archived") throw errors.PAGE_ARCHIVED();
    return { id: outcome.id, versionId: outcome.versionId };
  },
);

export const archivePageProcedure = authed.website.archivePage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await archiveLandingPage(context.database, context.workspace, input.id))) {
      throw errors.NOT_FOUND();
    }
    return { archived: true as const };
  },
);

export const listMessagesProcedure = authed.website.listMessages.handler(({ context }) =>
  listSiteMessages(context.database, context.workspace),
);

export const createMessageProcedure = authed.website.createMessage.handler(
  ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return createSiteMessage(context.database, context.workspace, input);
  },
);

export const updateMessageProcedure = authed.website.updateMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const { id, ...changes } = input;
    if (!(await updateSiteMessage(context.database, context.workspace, id, changes))) {
      throw errors.NOT_FOUND();
    }
    return { id };
  },
);

export const archiveMessageProcedure = authed.website.archiveMessage.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    if (!(await archiveSiteMessage(context.database, context.workspace, input.id))) {
      throw errors.NOT_FOUND();
    }
    return { archived: true as const };
  },
);

export const getTrackingProcedure = authed.website.getTracking.handler(({ context }) =>
  getSiteTracking(context.database, context.workspace),
);

export const updateTrackingProcedure = authed.website.updateTracking.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "admin", errors.FORBIDDEN);
    // Domains are normalised before validation so "https://Example.com/" is accepted.
    const allowedDomains = input.allowedDomains.map((domain) => normalizeDomain(domain));
    if (allowedDomains.some((domain) => !isValidDomain(domain))) throw errors.INVALID_DOMAIN();
    if (input.enabled && allowedDomains.length === 0) throw errors.TRACKING_DOMAIN_REQUIRED();
    await saveSiteTracking(context.database, context.workspace, {
      enabled: input.enabled,
      allowedDomains,
    });
    return { saved: true as const };
  },
);

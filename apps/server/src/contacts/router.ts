import { writeAuditLog } from "@kaenma/database";
import { ContactRepository } from "@kaenma/database";
import { CSV_MAX_BYTES } from "@kaenma/orpc";

import { hasWorkspaceRole } from "../auth/authorization";
import { authed, requireRole } from "../orpc/base";
import {
  getContactExportFile,
  getDataJob,
  startContactExport,
  startContactImport,
} from "./import-export-service";
import { createContact, getContactTimeline, listContacts, recordContactApiEvent } from "./service";

export const listContactsProcedure = authed.contacts.list.handler(async ({ context, input }) =>
  listContacts(context.database, context.workspace, input),
);

export const getContactProcedure = authed.contacts.get.handler(
  async ({ context, input, errors }) => {
    const repository = new ContactRepository(context.database, context.workspace);
    const contact = await repository.getContact(input.id);
    if (!contact) throw errors.CONTACT_NOT_FOUND();
    return contact;
  },
);

export const contactTimelineProcedure = authed.contacts.timeline.handler(
  async ({ context, input, errors }) => {
    const timeline = await getContactTimeline(
      context.database,
      context.workspace.workspaceId,
      input.id,
    );
    if (!timeline) throw errors.CONTACT_NOT_FOUND();
    return timeline;
  },
);

export const recordContactEventProcedure = authed.contacts.recordEvent.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await recordContactApiEvent(context.database, context.workspace.workspaceId, {
      contactId: input.id,
      eventName: input.eventName,
      source: input.source,
      properties: input.properties,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    if (outcome.kind === "contact_not_found") throw errors.CONTACT_NOT_FOUND();
    return { eventId: outcome.eventId, enrollmentCount: outcome.enrollmentCount };
  },
);

export const createContactProcedure = authed.contacts.create.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) {
      throw errors.FORBIDDEN();
    }

    try {
      const contact = await createContact(context.database, context.workspace, input);
      context.executionContext.waitUntil(
        writeAuditLog(context.database, context.workspace, {
          action: "contact.create",
          resourceType: "contact",
          resourceId: contact.id,
        }),
      );
      return contact;
    } catch (error) {
      throw errors.CONTACT_CONFLICT({ cause: error });
    }
  },
);

export const updateContactProcedure = authed.contacts.update.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const { id, ...changes } = input;
    const repository = new ContactRepository(context.database, context.workspace);
    const existing = await repository.getContact(id);
    if (!existing) throw errors.CONTACT_NOT_FOUND();
    if (existing.status === "archived") throw errors.CONTACT_ARCHIVED();
    const contact = await repository.updateContact(id, changes);
    if (!contact) throw errors.CONTACT_NOT_FOUND();
    return contact;
  },
);

export const archiveContactProcedure = authed.contacts.archive.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "admin")) throw errors.FORBIDDEN();
    const archived = await new ContactRepository(
      context.database,
      context.workspace,
    ).archiveContact(input.id);
    if (!archived) throw errors.CONTACT_NOT_FOUND();
    return { archived: true as const };
  },
);

export const importContactsProcedure = authed.operations.importContacts.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (input.file.size > CSV_MAX_BYTES) throw errors.CSV_TOO_LARGE();
    const csvText = await input.file.text();
    const outcome = await startContactImport(
      context.database,
      { bucket: context.env.ASSETS_BUCKET, queue: context.env.CAMPAIGN_QUEUE },
      context.workspace,
      csvText,
    );
    if (outcome.kind === "identifier_missing") throw errors.CSV_IDENTIFIER_MISSING();
    return { jobId: outcome.jobId, rows: outcome.rows, parts: outcome.parts };
  },
);

export const exportContactsProcedure = authed.operations.exportContacts.handler(
  async ({ context, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return startContactExport(context.database, context.env.CAMPAIGN_QUEUE, context.workspace);
  },
);

export const getDataJobProcedure = authed.operations.getDataJob.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const job = await getDataJob(context.database, context.workspace.workspaceId, input.id);
    if (!job) throw errors.DATA_JOB_NOT_FOUND();
    return job;
  },
);

export const downloadContactExportProcedure = authed.operations.downloadContactExport.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    const outcome = await getContactExportFile(
      context.database,
      context.env.ASSETS_BUCKET,
      context.workspace.workspaceId,
      input.id,
    );
    if (outcome.kind === "not_ready") throw errors.EXPORT_NOT_READY();
    if (outcome.kind === "missing") throw errors.EXPORT_MISSING();
    return outcome.file;
  },
);

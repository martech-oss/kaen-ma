import { writeAuditLog } from "@kaenma/database";
import { ContactRepository } from "@kaenma/database";

import { hasWorkspaceRole } from "../auth/authorization";
import { authed, requireRole } from "../orpc/base";
import {
  createContact,
  getContactTimeline,
  listContacts,
  recordContactApiEvent,
} from "./service";

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

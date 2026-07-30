import { writeAuditLog } from "@kaenma/database";
import { ContactRepository } from "@kaenma/database";

import { hasWorkspaceRole } from "../auth/authorization";
import { authed } from "../orpc/base";
import { createContact, listContacts } from "./service";

export const listContactsProcedure = authed.contacts.list.handler(async ({ context, input }) =>
  listContacts(context.database, context.workspace, input),
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

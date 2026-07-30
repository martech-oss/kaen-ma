import { writeAuditLog } from "@kaenma/database";

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

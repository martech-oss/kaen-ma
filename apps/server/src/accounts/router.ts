import { hasWorkspaceRole } from "../auth/authorization";
import { authed } from "../orpc/base";
import {
  AccountConflictError,
  assignAccountContact,
  createAccount,
  getAccountDetail,
  listAccounts,
  removeAccountContact,
  updateAccount,
} from "./service";

export const listAccountsProcedure = authed.accounts.list.handler(({ context, input }) =>
  listAccounts(context.database, context.workspace, {
    ...(input.query ? { query: input.query } : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }),
);

export const getAccountProcedure = authed.accounts.get.handler(
  async ({ context, input, errors }) => {
    const account = await getAccountDetail(context.database, context.workspace, input.id);
    if (!account) throw errors.ACCOUNT_NOT_FOUND();
    return account;
  },
);

export const createAccountProcedure = authed.accounts.create.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    try {
      return await createAccount(
        context.database,
        context.workspace,
        input,
        context.executionContext,
      );
    } catch (error) {
      if (error instanceof AccountConflictError) throw errors.ACCOUNT_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const updateAccountProcedure = authed.accounts.update.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const { id, ...changes } = input;
    try {
      const account = await updateAccount(context.database, context.workspace, id, changes);
      if (!account) throw errors.ACCOUNT_NOT_FOUND();
      return account;
    } catch (error) {
      if (error instanceof AccountConflictError) throw errors.ACCOUNT_CONFLICT({ cause: error });
      throw error;
    }
  },
);

export const assignAccountContactProcedure = authed.accounts.assignContact.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const assigned = await assignAccountContact(context.database, context.workspace, input);
    if (!assigned) throw errors.ACCOUNT_CONTACT_NOT_FOUND();
    return { assigned: true as const };
  },
);

export const removeAccountContactProcedure = authed.accounts.removeContact.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const removed = await removeAccountContact(context.database, context.workspace, input);
    if (!removed) throw errors.ACCOUNT_CONTACT_NOT_FOUND();
    return { removed: true as const };
  },
);

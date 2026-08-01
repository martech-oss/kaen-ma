import {
  AccountRepository,
  writeAuditLog,
  type KaenmaDatabase,
  type AccountSummary as RepositoryAccountSummary,
} from "@kaenma/database";
import type {
  Account,
  AccountContact,
  AccountCreate,
  AccountDetail,
  AccountUpdate,
  WorkspaceContext,
} from "@kaenma/orpc";

/** Raised when a write conflicts with the unique domain constraint. */
export class AccountConflictError extends Error {
  public constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AccountConflictError";
  }
}

export function listAccounts(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { query?: string; limit?: number },
): Promise<RepositoryAccountSummary[]> {
  return new AccountRepository(database, workspace).listAccounts(input);
}

export async function getAccountDetail(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<AccountDetail | null> {
  const repository = new AccountRepository(database, workspace);
  const account = await repository.getAccount(id);
  if (!account) return null;
  const contacts = await repository.listAccountContacts(account.id);
  return {
    ...account,
    contacts: contacts.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      stage: row.stage,
      score: row.score,
      status: row.status as AccountContact["status"],
      title: row.title,
      isPrimary: Boolean(row.isPrimary),
    })),
  };
}

export async function createAccount(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: AccountCreate,
  background: { waitUntil(promise: Promise<unknown>): void },
): Promise<Account> {
  let account: Account;
  try {
    account = await new AccountRepository(database, workspace).createAccount(input);
  } catch (error) {
    throw new AccountConflictError(error);
  }
  background.waitUntil(
    writeAuditLog(database, workspace, {
      action: "account.create",
      resourceType: "account",
      resourceId: account.id,
    }),
  );
  return account;
}

export async function updateAccount(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: AccountUpdate,
): Promise<Account | null> {
  try {
    return await new AccountRepository(database, workspace).updateAccount(id, input);
  } catch (error) {
    throw new AccountConflictError(error);
  }
}

/**
 * Attaches a contact to an account. Returns false when either side is missing.
 * Promoting a contact to primary demotes it on every other account in one batch,
 * so a contact is never primary in two places.
 */
export async function assignAccountContact(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { id: string; contactId: string; title?: string | undefined; isPrimary: boolean },
): Promise<boolean> {
  const repository = new AccountRepository(database, workspace);
  if (!(await repository.hasAssignableContact(input.id, input.contactId))) return false;
  await repository.assignContact({
    accountId: input.id,
    contactId: input.contactId,
    title: input.title ?? null,
    isPrimary: input.isPrimary,
  });
  return true;
}

export function removeAccountContact(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { id: string; contactId: string },
): Promise<boolean> {
  return new AccountRepository(database, workspace).removeContact(input.id, input.contactId);
}

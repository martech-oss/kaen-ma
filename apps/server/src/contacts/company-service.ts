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

interface AccountContactRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  stage: string;
  score: number;
  status: AccountContact["status"];
  title: string | null;
  is_primary: number;
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
  const account = await new AccountRepository(database, workspace).getAccount(id);
  if (!account) return null;
  const contacts = await database
    .prepare(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.stage, c.score,
              c.status, cc.title, cc.is_primary
       FROM company_contacts cc
       JOIN contacts c
         ON c.workspace_id = cc.workspace_id AND c.id = cc.contact_id
       WHERE cc.workspace_id = ? AND cc.company_id = ?
       ORDER BY cc.is_primary DESC,
                COALESCE(c.last_name, c.first_name, c.email, c.id) ASC`,
    )
    .bind(workspace.workspaceId, account.id)
    .all<AccountContactRow>();
  return {
    ...account,
    contacts: contacts.results.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      stage: row.stage,
      score: row.score,
      status: row.status,
      title: row.title,
      isPrimary: Boolean(row.is_primary),
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
  const workspaceId = workspace.workspaceId;
  const relationExists = await database
    .prepare(
      `SELECT co.id
         FROM companies co
         JOIN contacts c ON c.workspace_id = co.workspace_id
         WHERE co.workspace_id = ? AND co.id = ? AND c.id = ?
           AND c.status != 'archived'`,
    )
    .bind(workspaceId, input.id, input.contactId)
    .first();
  if (!relationExists) return false;
  const now = new Date().toISOString();
  const assign = database
    .prepare(
      `INSERT INTO company_contacts
         (workspace_id, company_id, contact_id, title, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, company_id, contact_id)
         DO UPDATE SET title = excluded.title, is_primary = excluded.is_primary`,
    )
    .bind(
      workspaceId,
      input.id,
      input.contactId,
      input.title ?? null,
      input.isPrimary ? 1 : 0,
      now,
    );
  if (input.isPrimary) {
    await database.batch([
      database
        .prepare(
          `UPDATE company_contacts SET is_primary = 0
             WHERE workspace_id = ? AND contact_id = ?`,
        )
        .bind(workspaceId, input.contactId),
      assign,
    ]);
  } else {
    await assign.run();
  }
  return true;
}

export async function removeAccountContact(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { id: string; contactId: string },
): Promise<boolean> {
  const result = await database
    .prepare(
      `DELETE FROM company_contacts
         WHERE workspace_id = ? AND company_id = ? AND contact_id = ?`,
    )
    .bind(workspace.workspaceId, input.id, input.contactId)
    .run();
  return result.meta.changes > 0;
}

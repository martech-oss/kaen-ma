import type { Account, AccountCreate, AccountUpdate, WorkspaceContext } from "@kaenma/shared";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { uuidv7 } from "../shared/uuid";

interface AccountRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountSummary extends Account {
  contactCount: number;
}

export class AccountRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: WorkspaceContext,
  ) {
    this.database = createDatabase(database);
  }

  public async listAccounts(input: { query?: string; limit?: number }): Promise<AccountSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const params: Array<string | number> = [this.context.workspaceId];
    const conditions = ["co.workspace_id = ?"];
    if (input.query) {
      const query = `%${escapeLike(input.query)}%`;
      conditions.push("(co.name LIKE ? ESCAPE '\\' OR co.domain LIKE ? ESCAPE '\\')");
      params.push(query, query);
    }
    params.push(limit);
    const result = await this.database
      .prepare(
        `SELECT co.id, co.workspace_id, co.name, co.domain,
                co.created_at, co.updated_at,
                COUNT(CASE WHEN c.status != 'archived' THEN 1 END) AS contact_count
         FROM companies co
         LEFT JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         LEFT JOIN contacts c
           ON c.workspace_id = cc.workspace_id AND c.id = cc.contact_id
         WHERE ${conditions.join(" AND ")}
         GROUP BY co.id
         ORDER BY co.updated_at DESC, co.id DESC
         LIMIT ?`,
      )
      .bind(...params)
      .all<AccountRow & { contact_count: number }>();
    return result.results.map((row) => ({
      ...toAccount(row),
      contactCount: Number(row.contact_count),
    }));
  }

  public async getAccount(id: string): Promise<Account | null> {
    const row = await this.database
      .prepare(
        `SELECT id, workspace_id, name, domain, created_at, updated_at
         FROM companies WHERE workspace_id = ? AND id = ?`,
      )
      .bind(this.context.workspaceId, id)
      .first<AccountRow>();
    return row ? toAccount(row) : null;
  }

  public async createAccount(input: AccountCreate): Promise<Account> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database
      .prepare(
        `INSERT INTO companies
         (id, workspace_id, name, domain, custom_fields, created_at, updated_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      )
      .bind(id, this.context.workspaceId, input.name, input.domain?.toLowerCase() ?? null, now, now)
      .run();
    const account = await this.getAccount(id);
    if (!account) throw new Error("Created account could not be loaded");
    return account;
  }

  public async updateAccount(id: string, input: AccountUpdate): Promise<Account | null> {
    const existing = await this.getAccount(id);
    if (!existing) return null;
    await this.database
      .prepare(
        `UPDATE companies SET name = ?, domain = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .bind(
        input.name ?? existing.name,
        input.domain === undefined ? existing.domain : (input.domain?.toLowerCase() ?? null),
        new Date().toISOString(),
        this.context.workspaceId,
        id,
      )
      .run();
    return this.getAccount(id);
  }
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    domain: row.domain,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

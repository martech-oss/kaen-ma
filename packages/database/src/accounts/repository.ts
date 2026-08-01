import { and, desc, eq, like, or, sql } from "drizzle-orm";

import type { Account, AccountCreate, AccountUpdate, WorkspaceContext } from "@kaenma/shared";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { companies, companyContacts, contacts } from "../contacts/schema";
import { uuidv7 } from "../shared/uuid";

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
    const conditions = [eq(companies.workspaceId, this.context.workspaceId)];
    if (input.query) {
      const query = `%${escapeLike(input.query)}%`;
      conditions.push(or(like(companies.name, query), like(companies.domain, query))!);
    }
    const rows = await this.database.orm
      .select({
        id: companies.id,
        workspaceId: companies.workspaceId,
        name: companies.name,
        domain: companies.domain,
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
        contactCount:
          sql<number>`count(case when ${contacts.status} != 'archived' then 1 end)`.mapWith(Number),
      })
      .from(companies)
      .leftJoin(
        companyContacts,
        and(
          eq(companyContacts.workspaceId, companies.workspaceId),
          eq(companyContacts.companyId, companies.id),
        ),
      )
      .leftJoin(
        contacts,
        and(
          eq(contacts.workspaceId, companyContacts.workspaceId),
          eq(contacts.id, companyContacts.contactId),
        ),
      )
      .where(and(...conditions))
      .groupBy(companies.id)
      .orderBy(desc(companies.updatedAt), desc(companies.id))
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      contactCount: Number(row.contactCount),
    }));
  }

  public async getAccount(id: string): Promise<Account | null> {
    const row = await this.database.orm.query.companies.findFirst({
      columns: {
        id: true,
        workspaceId: true,
        name: true,
        domain: true,
        createdAt: true,
        updatedAt: true,
      },
      where: and(eq(companies.workspaceId, this.context.workspaceId), eq(companies.id, id)),
    });
    return row ?? null;
  }

  public async createAccount(input: AccountCreate): Promise<Account> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(companies).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      domain: input.domain?.toLowerCase() ?? null,
      customFields: "{}",
      createdAt: now,
      updatedAt: now,
    });
    const account = await this.getAccount(id);
    if (!account) throw new Error("Created account could not be loaded");
    return account;
  }

  public async updateAccount(id: string, input: AccountUpdate): Promise<Account | null> {
    const existing = await this.getAccount(id);
    if (!existing) return null;
    await this.database.orm
      .update(companies)
      .set({
        name: input.name ?? existing.name,
        domain:
          input.domain === undefined ? existing.domain : (input.domain?.toLowerCase() ?? null),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(companies.workspaceId, this.context.workspaceId), eq(companies.id, id)));
    return this.getAccount(id);
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

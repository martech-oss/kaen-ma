import { and, asc, desc, eq, like, ne, or, sql } from "drizzle-orm";

import type { Account, AccountCreate, AccountUpdate, WorkspaceContext } from "@kaenma/orpc";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { uuidv7 } from "../shared/uuid";
import { companies, companyContacts, contacts } from "./schema";

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

  /** Lists the contacts on an account, primary first, then by display name. */
  public listAccountContacts(accountId: string) {
    return this.database.orm
      .select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        stage: contacts.stage,
        score: contacts.score,
        status: contacts.status,
        title: companyContacts.title,
        isPrimary: companyContacts.isPrimary,
      })
      .from(companyContacts)
      .innerJoin(
        contacts,
        and(
          eq(contacts.workspaceId, companyContacts.workspaceId),
          eq(contacts.id, companyContacts.contactId),
        ),
      )
      .where(
        and(
          eq(companyContacts.workspaceId, this.context.workspaceId),
          eq(companyContacts.companyId, accountId),
        ),
      )
      .orderBy(
        desc(companyContacts.isPrimary),
        asc(
          sql`coalesce(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.id})`,
        ),
      );
  }

  /** True when both the account and a non-archived contact exist. */
  public async hasAssignableContact(accountId: string, contactId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: companies.id })
      .from(companies)
      .innerJoin(contacts, eq(contacts.workspaceId, companies.workspaceId))
      .where(
        and(
          eq(companies.workspaceId, this.context.workspaceId),
          eq(companies.id, accountId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    return row !== undefined;
  }

  /**
   * Upserts the account–contact link. Promoting a contact to primary demotes
   * it on every other account in the same atomic batch, so a contact is never
   * primary in two places.
   */
  public async assignContact(input: {
    accountId: string;
    contactId: string;
    title: string | null;
    isPrimary: boolean;
  }): Promise<void> {
    const workspaceId = this.context.workspaceId;
    const isPrimary = input.isPrimary ? 1 : 0;
    const assign = this.database.orm
      .insert(companyContacts)
      .values({
        workspaceId,
        companyId: input.accountId,
        contactId: input.contactId,
        title: input.title,
        isPrimary,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [companyContacts.workspaceId, companyContacts.companyId, companyContacts.contactId],
        set: { title: input.title, isPrimary },
      });
    if (input.isPrimary) {
      await this.database.orm.batch([
        this.database.orm
          .update(companyContacts)
          .set({ isPrimary: 0 })
          .where(
            and(
              eq(companyContacts.workspaceId, workspaceId),
              eq(companyContacts.contactId, input.contactId),
            ),
          ),
        assign,
      ]);
    } else {
      await assign;
    }
  }

  public async removeContact(accountId: string, contactId: string): Promise<boolean> {
    const result = await this.database.orm
      .delete(companyContacts)
      .where(
        and(
          eq(companyContacts.workspaceId, this.context.workspaceId),
          eq(companyContacts.companyId, accountId),
          eq(companyContacts.contactId, contactId),
        ),
      );
    return result.meta.changes > 0;
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

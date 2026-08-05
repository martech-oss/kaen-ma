import type { Company, CompanyCreate, CompanyUpdate } from "@openengage/core/contacts";
import type { WorkspaceContext } from "@openengage/core/shared";
import { and, asc, desc, eq, like, ne, or, sql } from "drizzle-orm";

import { createDatabase, type DatabaseSource, type OpenEngageDatabase } from "../client";
import { escapeLike } from "../shared/database-utils";
import { uuidv7 } from "../shared/uuid";
import { companies, companyContacts, contacts } from "./schema";

export interface CompanySummary extends Company {
  contactCount: number;
}

export class CompanyRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: WorkspaceContext,
  ) {
    this.database = createDatabase(database);
  }

  public async listCompanies(input: { query?: string; limit?: number }): Promise<CompanySummary[]> {
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

  public async getCompany(id: string): Promise<Company | null> {
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

  public async createCompany(input: CompanyCreate): Promise<Company> {
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
    const company = await this.getCompany(id);
    if (!company) throw new Error("Created company could not be loaded");
    return company;
  }

  public async updateCompany(id: string, input: CompanyUpdate): Promise<Company | null> {
    const existing = await this.getCompany(id);
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
    return this.getCompany(id);
  }

  /** Lists the contacts on an company, primary first, then by display name. */
  public listCompanyContacts(companyId: string) {
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
          eq(companyContacts.companyId, companyId),
        ),
      )
      .orderBy(
        desc(companyContacts.isPrimary),
        asc(
          sql`coalesce(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.id})`,
        ),
      );
  }

  /** True when both the company and a non-archived contact exist. */
  public async hasAssignableContact(companyId: string, contactId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: companies.id })
      .from(companies)
      .innerJoin(contacts, eq(contacts.workspaceId, companies.workspaceId))
      .where(
        and(
          eq(companies.workspaceId, this.context.workspaceId),
          eq(companies.id, companyId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    return row !== undefined;
  }

  /**
   * Upserts the company–contact link. Promoting a contact to primary demotes
   * it on every other company in the same atomic batch, so a contact is never
   * primary in two places.
   */
  public async assignContact(input: {
    companyId: string;
    contactId: string;
    title: string | null;
    isPrimary: boolean;
  }): Promise<void> {
    const workspaceId = this.context.workspaceId;
    const isPrimary = input.isPrimary;
    const assign = this.database.orm
      .insert(companyContacts)
      .values({
        workspaceId,
        companyId: input.companyId,
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
          .set({ isPrimary: false })
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

  public async removeContact(companyId: string, contactId: string): Promise<boolean> {
    const result = await this.database.orm
      .delete(companyContacts)
      .where(
        and(
          eq(companyContacts.workspaceId, this.context.workspaceId),
          eq(companyContacts.companyId, companyId),
          eq(companyContacts.contactId, contactId),
        ),
      );
    return result.meta.changes > 0;
  }
}

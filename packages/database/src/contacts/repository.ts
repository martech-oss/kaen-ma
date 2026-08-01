import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import type { WorkspaceContext } from "@kaenma/shared";
import type { Contact, ContactCreate, ContactUpdate } from "@kaenma/shared/contacts";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { uuidv7 } from "../shared/uuid";
import {
  companyContacts,
  contactListMemberships,
  contacts,
  contactTags,
  segmentMemberships,
} from "./schema";

export interface CursorPage<T> {
  items: T[];
  total: number;
  nextCursor?: string;
}

type ContactRow = typeof contacts.$inferSelect;

export class ContactRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: WorkspaceContext,
  ) {
    this.database = createDatabase(database);
  }

  public async listContacts(input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    query?: string | undefined;
    status?: "active" | "archived" | "anonymous" | "all" | undefined;
    stage?: string | undefined;
    tagId?: string | undefined;
    listId?: string | undefined;
    accountId?: string | undefined;
    segmentId?: string | undefined;
    scoreMin?: number | undefined;
    scoreMax?: number | undefined;
    sort?: "createdAt" | "updatedAt" | "score" | "name" | "email" | undefined;
    direction?: "asc" | "desc" | undefined;
  }): Promise<CursorPage<Contact>> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const conditions: SQL[] = [eq(contacts.workspaceId, this.context.workspaceId)];
    const ascending = input.direction === "asc";
    const sortColumn = {
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      score: contacts.score,
      name: sql<string>`coalesce(${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, '')`,
      email: sql<string>`coalesce(${contacts.email}, '')`,
    }[input.sort ?? "updatedAt"];
    if (input.query) {
      const query = `%${escapeLike(input.query)}%`;
      conditions.push(
        or(
          escapedLike(contacts.email, query),
          escapedLike(contacts.firstName, query),
          escapedLike(contacts.lastName, query),
          escapedLike(contacts.phone, query),
          escapedLike(contacts.externalId, query),
        )!,
      );
    }
    const status = input.status ?? "active";
    if (status !== "all") {
      conditions.push(eq(contacts.status, status));
    }
    if (input.stage) {
      conditions.push(eq(contacts.stage, input.stage));
    }
    if (input.scoreMin !== undefined) {
      conditions.push(gte(contacts.score, input.scoreMin));
    }
    if (input.scoreMax !== undefined) {
      conditions.push(lte(contacts.score, input.scoreMax));
    }
    if (input.tagId) {
      conditions.push(
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contactTags)
            .where(
              and(
                eq(contactTags.workspaceId, contacts.workspaceId),
                eq(contactTags.contactId, contacts.id),
                eq(contactTags.tagId, input.tagId),
              ),
            ),
        ),
      );
    }
    if (input.listId) {
      conditions.push(
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contactListMemberships)
            .where(
              and(
                eq(contactListMemberships.workspaceId, contacts.workspaceId),
                eq(contactListMemberships.contactId, contacts.id),
                eq(contactListMemberships.listId, input.listId),
                eq(contactListMemberships.status, "active"),
              ),
            ),
        ),
      );
    }
    if (input.accountId) {
      conditions.push(
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(companyContacts)
            .where(
              and(
                eq(companyContacts.workspaceId, contacts.workspaceId),
                eq(companyContacts.contactId, contacts.id),
                eq(companyContacts.companyId, input.accountId),
              ),
            ),
        ),
      );
    }
    if (input.segmentId) {
      conditions.push(
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(segmentMemberships)
            .where(
              and(
                eq(segmentMemberships.workspaceId, contacts.workspaceId),
                eq(segmentMemberships.contactId, contacts.id),
                eq(segmentMemberships.segmentId, input.segmentId),
              ),
            ),
        ),
      );
    }
    const [totalRow] = await this.database.orm
      .select({ count: count() })
      .from(contacts)
      .where(and(...conditions));
    const pageConditions: SQL[] = [...conditions];
    if (input.cursor) {
      const [cursor] = await this.database.orm
        .select({ sortValue: sortColumn })
        .from(contacts)
        .where(
          and(eq(contacts.workspaceId, this.context.workspaceId), eq(contacts.id, input.cursor)),
        )
        .limit(1);
      if (cursor) {
        pageConditions.push(
          or(
            compare(sortColumn, cursor.sortValue, ascending),
            and(
              equal(sortColumn, cursor.sortValue),
              ascending ? gt(contacts.id, input.cursor) : lt(contacts.id, input.cursor),
            ),
          )!,
        );
      }
    }
    const order = ascending ? asc : desc;
    const rows = await this.database.orm
      .select()
      .from(contacts)
      .where(and(...pageConditions))
      .orderBy(order(sortColumn), order(contacts.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toContact);
    const last = items.at(-1);
    return {
      items,
      total: totalRow?.count ?? 0,
      ...(hasMore && last ? { nextCursor: last.id } : {}),
    };
  }

  public async getContact(id: string): Promise<Contact | null> {
    const row = await this.database.orm.query.contacts.findFirst({
      where: and(eq(contacts.workspaceId, this.context.workspaceId), eq(contacts.id, id)),
    });
    return row ? toContact(row) : null;
  }

  public async createContact(input: ContactCreate): Promise<Contact> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(contacts).values({
      id,
      workspaceId: this.context.workspaceId,
      email: input.email?.toLowerCase() ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      externalId: input.externalId ?? null,
      stage: input.stage ?? "lead",
      score: 0,
      status: "active",
      customFields: JSON.stringify(input.customFields),
      createdAt: now,
      updatedAt: now,
    });
    const contact = await this.getContact(id);
    if (!contact) throw new Error("Created contact could not be loaded");
    return contact;
  }

  public async updateContact(id: string, input: ContactUpdate): Promise<Contact | null> {
    const existing = await this.getContact(id);
    if (!existing) return null;
    const fields = {
      email: input.email === undefined ? existing.email : (input.email?.toLowerCase() ?? null),
      firstName: input.firstName === undefined ? existing.firstName : (input.firstName ?? null),
      lastName: input.lastName === undefined ? existing.lastName : (input.lastName ?? null),
      phone: input.phone === undefined ? existing.phone : (input.phone ?? null),
      externalId: input.externalId === undefined ? existing.externalId : (input.externalId ?? null),
      stage: input.stage === undefined ? existing.stage : input.stage,
      customFields: input.customFields === undefined ? existing.customFields : input.customFields,
    };
    await this.database.orm
      .update(contacts)
      .set({
        email: fields.email,
        firstName: fields.firstName,
        lastName: fields.lastName,
        phone: fields.phone,
        externalId: fields.externalId,
        stage: fields.stage,
        customFields: JSON.stringify(fields.customFields),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(contacts.workspaceId, this.context.workspaceId), eq(contacts.id, id)));
    return this.getContact(id);
  }

  public async archiveContact(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(contacts)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(contacts.workspaceId, this.context.workspaceId),
          eq(contacts.id, id),
          ne(contacts.status, "archived"),
        ),
      );
    return result.meta.changes > 0;
  }

  public async restoreContact(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(contacts)
      .set({ status: "active", archivedAt: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(contacts.workspaceId, this.context.workspaceId),
          eq(contacts.id, id),
          eq(contacts.status, "archived"),
        ),
      );
    return result.meta.changes > 0;
  }
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    visitorId: row.visitorId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    externalId: row.externalId,
    stage: row.stage,
    score: row.score,
    status: row.status as Contact["status"],
    archivedAt: row.archivedAt,
    customFields: safeJson(row.customFields),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function escapedLike(column: SQLWrapper, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

function compare(column: SQLWrapper, value: string | number, ascending: boolean): SQL {
  return ascending ? gt(column, value) : lt(column, value);
}

function equal(column: SQLWrapper, value: string | number): SQL {
  return sql`${column} = ${value}`;
}

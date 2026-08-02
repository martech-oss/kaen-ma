import { and, asc, count, desc, eq, exists, inArray, ne, sql, type SQL } from "drizzle-orm";

import type { SegmentFilter, WorkspaceContext } from "@kaenma/orpc";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { segmentMemberships, segments } from "../segments/schema";
import { uuidv7 } from "../shared/uuid";
import {
  companies,
  companyContacts,
  contactEvents,
  contactListMemberships,
  contactLists,
  contacts,
  contactTags,
  scoreEvents,
  tags,
} from "./schema";

export interface ContactEventRow {
  id: string;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  properties: Record<string, unknown>;
  occurredAt: string;
}

/**
 * Queries for the resources hanging off a contact: tags, lists, segments,
 * accounts, score events and the activity timeline.
 *
 * Scoped by workspace id only (not the full {@link WorkspaceContext}), because
 * the timeline and public event endpoints resolve just the workspace id.
 * A full context is assignable wherever this scope is expected.
 */
export class ContactResourceRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
  ) {
    this.database = createDatabase(database);
  }

  /** Loads every filter option for the contact list page in one atomic batch. */
  public async getContactOptionRows() {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [tagRows, listRows, segmentRows, stageRows, accountRows] = await orm.batch([
      orm
        .select({
          id: tags.id,
          name: tags.name,
          slug: tags.slug,
          color: tags.color,
          contactCount: count(contactTags.contactId).as("contact_count"),
        })
        .from(tags)
        .leftJoin(
          contactTags,
          and(eq(contactTags.workspaceId, tags.workspaceId), eq(contactTags.tagId, tags.id)),
        )
        .where(eq(tags.workspaceId, workspaceId))
        .groupBy(tags.id)
        .orderBy(asc(tags.name)),
      orm
        .select({
          id: contactLists.id,
          name: contactLists.name,
          slug: contactLists.slug,
          description: contactLists.description,
          color: contactLists.color,
          contactCount:
            sql<number>`count(case when ${contactListMemberships.status} = 'active' then 1 end)`
              .mapWith(Number)
              .as("contact_count"),
        })
        .from(contactLists)
        .leftJoin(
          contactListMemberships,
          and(
            eq(contactListMemberships.workspaceId, contactLists.workspaceId),
            eq(contactListMemberships.listId, contactLists.id),
          ),
        )
        .where(eq(contactLists.workspaceId, workspaceId))
        .groupBy(contactLists.id)
        .orderBy(asc(contactLists.name)),
      orm
        .select({
          id: segments.id,
          name: segments.name,
          slug: segments.slug,
          kind: segments.kind,
          filterAst: segments.filterAst,
          memberCount: segments.memberCount,
          evaluatedAt: segments.evaluatedAt,
        })
        .from(segments)
        .where(eq(segments.workspaceId, workspaceId))
        .orderBy(asc(segments.name)),
      orm
        .select({ stage: contacts.stage, contactCount: count().as("contact_count") })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), ne(contacts.status, "archived")))
        .groupBy(contacts.stage)
        .orderBy(asc(contacts.stage)),
      orm
        .select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          contactCount: sql<number>`count(case when ${contacts.status} != 'archived' then 1 end)`
            .mapWith(Number)
            .as("contact_count"),
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
        .where(eq(companies.workspaceId, workspaceId))
        .groupBy(companies.id)
        .orderBy(asc(companies.name)),
    ]);
    return {
      tags: tagRows,
      lists: listRows,
      segments: segmentRows.map((row) => ({ ...row, filterAst: parseFilterAst(row.filterAst) })),
      stages: stageRows,
      accounts: accountRows,
    };
  }

  /** Loads every relation shown on a contact profile in one atomic batch. */
  public async getContactProfileRows(contactId: string) {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [tagRows, listRows, segmentRows, accountRows, scoreEventRows, timelineRows] =
      await orm.batch([
        orm
          .select({ id: tags.id, name: tags.name, slug: tags.slug, color: tags.color })
          .from(tags)
          .innerJoin(
            contactTags,
            and(eq(contactTags.workspaceId, tags.workspaceId), eq(contactTags.tagId, tags.id)),
          )
          .where(
            and(eq(contactTags.workspaceId, workspaceId), eq(contactTags.contactId, contactId)),
          )
          .orderBy(asc(tags.name)),
        orm
          .select({
            id: contactLists.id,
            name: contactLists.name,
            slug: contactLists.slug,
            color: contactLists.color,
            status: contactListMemberships.status,
            updatedAt: contactListMemberships.updatedAt,
          })
          .from(contactLists)
          .innerJoin(
            contactListMemberships,
            and(
              eq(contactListMemberships.workspaceId, contactLists.workspaceId),
              eq(contactListMemberships.listId, contactLists.id),
            ),
          )
          .where(
            and(
              eq(contactListMemberships.workspaceId, workspaceId),
              eq(contactListMemberships.contactId, contactId),
            ),
          )
          .orderBy(asc(contactLists.name)),
        orm
          .select({
            id: segments.id,
            name: segments.name,
            kind: segments.kind,
            source: segmentMemberships.source,
            joinedAt: segmentMemberships.joinedAt,
          })
          .from(segments)
          .innerJoin(
            segmentMemberships,
            and(
              eq(segmentMemberships.workspaceId, segments.workspaceId),
              eq(segmentMemberships.segmentId, segments.id),
            ),
          )
          .where(
            and(
              eq(segmentMemberships.workspaceId, workspaceId),
              eq(segmentMemberships.contactId, contactId),
            ),
          )
          .orderBy(asc(segments.name)),
        orm
          .select({
            id: companies.id,
            name: companies.name,
            domain: companies.domain,
            title: companyContacts.title,
            isPrimary: companyContacts.isPrimary,
          })
          .from(companies)
          .innerJoin(
            companyContacts,
            and(
              eq(companyContacts.workspaceId, companies.workspaceId),
              eq(companyContacts.companyId, companies.id),
            ),
          )
          .where(
            and(
              eq(companyContacts.workspaceId, workspaceId),
              eq(companyContacts.contactId, contactId),
            ),
          )
          .orderBy(desc(companyContacts.isPrimary), asc(companies.name)),
        orm
          .select({
            id: scoreEvents.id,
            delta: scoreEvents.delta,
            total: scoreEvents.total,
            reason: scoreEvents.reason,
            createdAt: scoreEvents.createdAt,
          })
          .from(scoreEvents)
          .where(
            and(eq(scoreEvents.workspaceId, workspaceId), eq(scoreEvents.contactId, contactId)),
          )
          .orderBy(desc(scoreEvents.createdAt))
          .limit(100),
        this.contactEventsQuery(contactId, 100),
      ]);
    return {
      tags: tagRows,
      lists: listRows,
      segments: segmentRows,
      accounts: accountRows,
      scoreEvents: scoreEventRows,
      timeline: timelineRows.map(toContactEvent),
    };
  }

  /** Newest-first activity feed for one contact. */
  public async listContactEvents(contactId: string, limit: number): Promise<ContactEventRow[]> {
    const rows = await this.contactEventsQuery(contactId, limit);
    return rows.map(toContactEvent);
  }

  /** Loads the tag, list and account chips for a page of contacts in one batch. */
  public async listContactRelations(contactIds: string[]) {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const [tagRows, listRows, accountRows] = await orm.batch([
      orm
        .select({
          contactId: contactTags.contactId,
          id: tags.id,
          name: tags.name,
          slug: tags.slug,
          color: tags.color,
        })
        .from(contactTags)
        .innerJoin(
          tags,
          and(eq(tags.workspaceId, contactTags.workspaceId), eq(tags.id, contactTags.tagId)),
        )
        .where(
          and(eq(contactTags.workspaceId, workspaceId), inArray(contactTags.contactId, contactIds)),
        )
        .orderBy(asc(tags.name)),
      orm
        .select({
          contactId: contactListMemberships.contactId,
          id: contactLists.id,
          name: contactLists.name,
          slug: contactLists.slug,
          color: contactLists.color,
        })
        .from(contactListMemberships)
        .innerJoin(
          contactLists,
          and(
            eq(contactLists.workspaceId, contactListMemberships.workspaceId),
            eq(contactLists.id, contactListMemberships.listId),
          ),
        )
        .where(
          and(
            eq(contactListMemberships.workspaceId, workspaceId),
            eq(contactListMemberships.status, "active"),
            inArray(contactListMemberships.contactId, contactIds),
          ),
        )
        .orderBy(asc(contactLists.name)),
      orm
        .select({
          contactId: companyContacts.contactId,
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          title: companyContacts.title,
          isPrimary: companyContacts.isPrimary,
        })
        .from(companyContacts)
        .innerJoin(
          companies,
          and(
            eq(companies.workspaceId, companyContacts.workspaceId),
            eq(companies.id, companyContacts.companyId),
          ),
        )
        .where(
          and(
            eq(companyContacts.workspaceId, workspaceId),
            inArray(companyContacts.contactId, contactIds),
          ),
        )
        .orderBy(desc(companyContacts.isPrimary), asc(companies.name)),
    ]);
    return { tags: tagRows, lists: listRows, accounts: accountRows };
  }

  public async contactExists(contactId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, this.context.workspaceId), eq(contacts.id, contactId)))
      .get();
    return row !== undefined;
  }

  public async findActiveContactId(contactId: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, this.context.workspaceId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    return row?.id ?? null;
  }

  /** Inserts a tag; unique-slug violations bubble up to the caller. */
  public async createTag(input: {
    id: string;
    name: string;
    slug: string;
    color: string;
  }): Promise<void> {
    await this.database.orm.insert(tags).values({
      id: input.id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      color: input.color,
      createdAt: new Date().toISOString(),
    });
  }

  /** Inserts a contact list; unique-slug violations bubble up to the caller. */
  public async createContactList(input: {
    id: string;
    name: string;
    slug: string;
    description: string;
    color: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.database.orm.insert(contactLists).values({
      id: input.id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    });
  }

  public async addContactTag(contactId: string, tagId: string): Promise<boolean> {
    return (await this.insertTagMemberships(eq(contacts.id, contactId), tagId)) > 0;
  }

  public bulkAddContactTag(contactIds: string[], tagId: string): Promise<number> {
    return this.insertTagMemberships(inArray(contacts.id, contactIds), tagId);
  }

  public async removeContactTag(contactId: string, tagId: string): Promise<boolean> {
    return (await this.deleteTagMemberships(eq(contactTags.contactId, contactId), tagId)) > 0;
  }

  public bulkRemoveContactTag(contactIds: string[], tagId: string): Promise<number> {
    return this.deleteTagMemberships(inArray(contactTags.contactId, contactIds), tagId);
  }

  public async addContactList(contactId: string, listId: string): Promise<boolean> {
    return (await this.upsertListMemberships(eq(contacts.id, contactId), listId, "manual")) > 0;
  }

  public bulkAddContactList(contactIds: string[], listId: string): Promise<number> {
    return this.upsertListMemberships(inArray(contacts.id, contactIds), listId, "bulk");
  }

  public async removeContactList(contactId: string, listId: string): Promise<boolean> {
    return (
      (await this.deleteListMemberships(eq(contactListMemberships.contactId, contactId), listId)) >
      0
    );
  }

  public bulkRemoveContactList(contactIds: string[], listId: string): Promise<number> {
    return this.deleteListMemberships(
      inArray(contactListMemberships.contactId, contactIds),
      listId,
    );
  }

  /** Joins a contact to a static segment; dynamic segments reject the write. */
  public async addContactSegment(contactId: string, segmentId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .insert(segmentMemberships)
      .select(
        this.database.orm
          .select({
            workspaceId: contacts.workspaceId,
            segmentId: segments.id,
            contactId: contacts.id,
            source: sql<string>`'static'`.as("source"),
            joinedAt: sql<string>`${now}`.as("joined_at"),
          })
          .from(contacts)
          .innerJoin(segments, eq(segments.workspaceId, contacts.workspaceId))
          .where(
            and(
              eq(contacts.workspaceId, this.context.workspaceId),
              eq(contacts.id, contactId),
              ne(contacts.status, "archived"),
              eq(segments.id, segmentId),
              eq(segments.kind, "static"),
            ),
          ),
      )
      .onConflictDoNothing();
    return result.meta.changes > 0;
  }

  /** Removes a manually added segment membership; dynamic memberships stay. */
  public async removeContactSegment(contactId: string, segmentId: string): Promise<boolean> {
    const result = await this.database.orm.delete(segmentMemberships).where(
      and(
        eq(segmentMemberships.workspaceId, this.context.workspaceId),
        eq(segmentMemberships.contactId, contactId),
        eq(segmentMemberships.segmentId, segmentId),
        eq(segmentMemberships.source, "static"),
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, segmentMemberships.workspaceId),
                eq(contacts.id, segmentMemberships.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
      ),
    );
    return result.meta.changes > 0;
  }

  /**
   * Applies the delta and records a score event carrying the resulting total.
   * Returns false when the contact is missing or archived, in which case
   * nothing is written.
   */
  public async adjustContactScore(
    contactId: string,
    input: { delta: number; reason: string },
  ): Promise<boolean> {
    const workspaceId = this.context.workspaceId;
    const now = new Date().toISOString();
    const updated = await this.database.orm
      .update(contacts)
      .set({ score: sql`${contacts.score} + ${input.delta}`, updatedAt: now })
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.id, contactId),
          ne(contacts.status, "archived"),
        ),
      );
    if (updated.meta.changes === 0) return false;
    await this.database.orm.insert(scoreEvents).select(
      this.database.orm
        .select({
          id: sql<string>`${uuidv7()}`.as("id"),
          workspaceId: contacts.workspaceId,
          contactId: contacts.id,
          delta: sql<number>`${input.delta}`.as("delta"),
          total: contacts.score,
          reason: sql<string>`${input.reason}`.as("reason"),
          automationEnrollmentId: sql<string | null>`null`.as("automation_enrollment_id"),
          createdAt: sql<string>`${now}`.as("created_at"),
        })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))),
    );
    return true;
  }

  /** Archives or restores many contacts at once, regardless of current status. */
  public async bulkSetContactsArchived(contactIds: string[], archived: boolean): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(contacts)
      .set({
        status: archived ? "archived" : "active",
        archivedAt: archived ? now : null,
        updatedAt: now,
      })
      .where(
        and(eq(contacts.workspaceId, this.context.workspaceId), inArray(contacts.id, contactIds)),
      );
    return result.meta.changes;
  }

  private contactEventsQuery(contactId: string, limit: number) {
    return this.database.orm
      .select({
        id: contactEvents.id,
        type: contactEvents.type,
        resourceType: contactEvents.resourceType,
        resourceId: contactEvents.resourceId,
        properties: contactEvents.properties,
        occurredAt: contactEvents.occurredAt,
      })
      .from(contactEvents)
      .where(
        and(
          eq(contactEvents.workspaceId, this.context.workspaceId),
          eq(contactEvents.contactId, contactId),
        ),
      )
      .orderBy(desc(contactEvents.occurredAt), desc(contactEvents.id))
      .limit(limit);
  }

  /**
   * Links every non-archived selected contact to the tag, skipping links that
   * already exist. Returns the number of rows actually written.
   */
  private async insertTagMemberships(contactFilter: SQL, tagId: string): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .insert(contactTags)
      .select(
        this.database.orm
          .select({
            workspaceId: contacts.workspaceId,
            contactId: contacts.id,
            tagId: tags.id,
            createdAt: sql<string>`${now}`.as("created_at"),
          })
          .from(contacts)
          .innerJoin(tags, eq(tags.workspaceId, contacts.workspaceId))
          .where(
            and(
              eq(contacts.workspaceId, this.context.workspaceId),
              contactFilter,
              ne(contacts.status, "archived"),
              eq(tags.id, tagId),
            ),
          ),
      )
      .onConflictDoNothing();
    return result.meta.changes;
  }

  /** Unlinks the tag from the selected contacts, ignoring archived contacts. */
  private async deleteTagMemberships(contactFilter: SQL, tagId: string): Promise<number> {
    const result = await this.database.orm.delete(contactTags).where(
      and(
        eq(contactTags.workspaceId, this.context.workspaceId),
        contactFilter,
        eq(contactTags.tagId, tagId),
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, contactTags.workspaceId),
                eq(contacts.id, contactTags.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
      ),
    );
    return result.meta.changes;
  }

  /**
   * Subscribes every non-archived selected contact to the list, reactivating
   * memberships that were unsubscribed. Returns the number of rows written.
   */
  private async upsertListMemberships(
    contactFilter: SQL,
    listId: string,
    source: "manual" | "bulk",
  ): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .insert(contactListMemberships)
      .select(
        this.database.orm
          .select({
            workspaceId: contacts.workspaceId,
            listId: contactLists.id,
            contactId: contacts.id,
            status: sql<string>`'active'`.as("status"),
            source: sql<string>`${source}`.as("source"),
            createdAt: sql<string>`${now}`.as("created_at"),
            updatedAt: sql<string>`${now}`.as("updated_at"),
          })
          .from(contacts)
          .innerJoin(contactLists, eq(contactLists.workspaceId, contacts.workspaceId))
          .where(
            and(
              eq(contacts.workspaceId, this.context.workspaceId),
              contactFilter,
              ne(contacts.status, "archived"),
              eq(contactLists.id, listId),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: [
          contactListMemberships.workspaceId,
          contactListMemberships.listId,
          contactListMemberships.contactId,
        ],
        set: { status: "active", source, updatedAt: now },
      });
    return result.meta.changes;
  }

  /** Removes the list membership rows for the selected non-archived contacts. */
  private async deleteListMemberships(contactFilter: SQL, listId: string): Promise<number> {
    const result = await this.database.orm.delete(contactListMemberships).where(
      and(
        eq(contactListMemberships.workspaceId, this.context.workspaceId),
        contactFilter,
        eq(contactListMemberships.listId, listId),
        exists(
          this.database.orm
            .select({ value: sql`1` })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, contactListMemberships.workspaceId),
                eq(contacts.id, contactListMemberships.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
      ),
    );
    return result.meta.changes;
  }
}

type ContactEventQueryRow = Omit<ContactEventRow, "properties"> & { properties: string };

function toContactEvent(row: ContactEventQueryRow): ContactEventRow {
  return { ...row, properties: safeJsonRecord(row.properties) };
}

/** Parses an object-shaped JSON column, treating malformed values as empty. */
function safeJsonRecord(value: string | null): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Parses a stored segment filter, treating malformed values as no filter. */
function parseFilterAst(value: string | null): SegmentFilter | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as SegmentFilter | null;
  } catch {
    return null;
  }
}

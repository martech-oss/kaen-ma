import type { Contact, ContactCreate, ContactUpdate, WorkspaceContext } from "@kaenma/shared";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { uuidv7 } from "../shared/uuid";

export interface CursorPage<T> {
  items: T[];
  total: number;
  nextCursor?: string;
}

interface ContactRow {
  id: string;
  workspace_id: string;
  visitor_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  external_id: string | null;
  stage: string;
  score: number;
  status: "active" | "archived" | "anonymous";
  archived_at: string | null;
  custom_fields: string;
  created_at: string;
  updated_at: string;
}

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
    const params: Array<string | number> = [this.context.workspaceId];
    const conditions = ["c.workspace_id = ?"];
    const direction = input.direction === "asc" ? "ASC" : "DESC";
    const sortColumn = {
      createdAt: "c.created_at",
      updatedAt: "c.updated_at",
      score: "c.score",
      name: "COALESCE(c.last_name, c.first_name, c.email, '')",
      email: "COALESCE(c.email, '')",
    }[input.sort ?? "updatedAt"];
    if (input.query) {
      conditions.push(
        `(c.email LIKE ? ESCAPE '\\'
          OR c.first_name LIKE ? ESCAPE '\\'
          OR c.last_name LIKE ? ESCAPE '\\'
          OR c.phone LIKE ? ESCAPE '\\'
          OR c.external_id LIKE ? ESCAPE '\\')`,
      );
      const query = `%${escapeLike(input.query)}%`;
      params.push(query, query, query, query, query);
    }
    const status = input.status ?? "active";
    if (status !== "all") {
      conditions.push("c.status = ?");
      params.push(status);
    }
    if (input.stage) {
      conditions.push("c.stage = ?");
      params.push(input.stage);
    }
    if (input.scoreMin !== undefined) {
      conditions.push("c.score >= ?");
      params.push(input.scoreMin);
    }
    if (input.scoreMax !== undefined) {
      conditions.push("c.score <= ?");
      params.push(input.scoreMax);
    }
    if (input.tagId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM contact_tags ct
          WHERE ct.workspace_id = c.workspace_id AND ct.contact_id = c.id AND ct.tag_id = ?
        )`,
      );
      params.push(input.tagId);
    }
    if (input.listId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM contact_list_memberships clm
          WHERE clm.workspace_id = c.workspace_id AND clm.contact_id = c.id
            AND clm.list_id = ? AND clm.status = 'active'
        )`,
      );
      params.push(input.listId);
    }
    if (input.accountId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM company_contacts cc
          WHERE cc.workspace_id = c.workspace_id AND cc.contact_id = c.id
            AND cc.company_id = ?
        )`,
      );
      params.push(input.accountId);
    }
    if (input.segmentId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM segment_memberships sm
          WHERE sm.workspace_id = c.workspace_id AND sm.contact_id = c.id AND sm.segment_id = ?
        )`,
      );
      params.push(input.segmentId);
    }
    const whereSql = conditions.join(" AND ");
    const count = await this.database
      .prepare(`SELECT COUNT(*) AS count FROM contacts c WHERE ${whereSql}`)
      .bind(...params)
      .first<{ count: number }>();
    const pageConditions = [...conditions];
    const pageParams = [...params];
    if (input.cursor) {
      const cursor = await this.database
        .prepare(
          `SELECT ${sortColumn} AS sort_value
           FROM contacts c WHERE c.workspace_id = ? AND c.id = ?`,
        )
        .bind(this.context.workspaceId, input.cursor)
        .first<{ sort_value: string | number }>();
      if (cursor) {
        const comparison = direction === "ASC" ? ">" : "<";
        pageConditions.push(
          `(${sortColumn} ${comparison} ? OR (${sortColumn} = ? AND c.id ${comparison} ?))`,
        );
        pageParams.push(cursor.sort_value, cursor.sort_value, input.cursor);
      }
    }
    pageParams.push(limit + 1);
    const result = await this.database
      .prepare(
        `SELECT c.* FROM contacts c
         WHERE ${pageConditions.join(" AND ")}
         ORDER BY ${sortColumn} ${direction}, c.id ${direction} LIMIT ?`,
      )
      .bind(...pageParams)
      .all<ContactRow>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toContact);
    const last = items.at(-1);
    return {
      items,
      total: count?.count ?? 0,
      ...(hasMore && last ? { nextCursor: last.id } : {}),
    };
  }

  public async getContact(id: string): Promise<Contact | null> {
    const row = await this.database
      .prepare("SELECT * FROM contacts WHERE workspace_id = ? AND id = ?")
      .bind(this.context.workspaceId, id)
      .first<ContactRow>();
    return row ? toContact(row) : null;
  }

  public async createContact(input: ContactCreate): Promise<Contact> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database
      .prepare(
        `INSERT INTO contacts (
          id, workspace_id, email, first_name, last_name, phone, external_id,
          stage, score, status, custom_fields, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
      )
      .bind(
        id,
        this.context.workspaceId,
        input.email?.toLowerCase() ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        input.phone ?? null,
        input.externalId ?? null,
        input.stage ?? "lead",
        JSON.stringify(input.customFields),
        now,
        now,
      )
      .run();
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
    await this.database
      .prepare(
        `UPDATE contacts SET email = ?, first_name = ?, last_name = ?, phone = ?,
         external_id = ?, stage = ?, custom_fields = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .bind(
        fields.email,
        fields.firstName,
        fields.lastName,
        fields.phone,
        fields.externalId,
        fields.stage,
        JSON.stringify(fields.customFields),
        new Date().toISOString(),
        this.context.workspaceId,
        id,
      )
      .run();
    return this.getContact(id);
  }

  public async archiveContact(id: string): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE contacts SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(new Date().toISOString(), new Date().toISOString(), this.context.workspaceId, id)
      .run();
    return result.meta.changes > 0;
  }

  public async restoreContact(id: string): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE contacts SET status = 'active', archived_at = NULL, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status = 'archived'`,
      )
      .bind(new Date().toISOString(), this.context.workspaceId, id)
      .run();
    return result.meta.changes > 0;
  }
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    visitorId: row.visitor_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    externalId: row.external_id,
    stage: row.stage,
    score: row.score,
    status: row.status,
    archivedAt: row.archived_at,
    customFields: safeJson(row.custom_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

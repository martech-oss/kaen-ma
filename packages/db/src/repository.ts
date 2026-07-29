import type {
  Account,
  AccountCreate,
  AccountUpdate,
  Contact,
  ContactCreate,
  ContactUpdate,
  WorkspaceContext,
  WorkspaceRole,
} from "@kaenma/shared";
import {
  createDatabase,
  type DatabaseSource,
  type KaenmaDatabase,
} from "./client";

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

export class WorkspaceRepository {
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
    sort?:
      | "createdAt"
      | "updatedAt"
      | "score"
      | "name"
      | "email"
      | undefined;
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
      email: input.email === undefined ? existing.email : input.email?.toLowerCase() ?? null,
      firstName: input.firstName === undefined ? existing.firstName : input.firstName ?? null,
      lastName: input.lastName === undefined ? existing.lastName : input.lastName ?? null,
      phone: input.phone === undefined ? existing.phone : input.phone ?? null,
      externalId: input.externalId === undefined ? existing.externalId : input.externalId ?? null,
      stage: input.stage === undefined ? existing.stage : input.stage,
      customFields:
        input.customFields === undefined ? existing.customFields : input.customFields,
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
      .bind(
        new Date().toISOString(),
        new Date().toISOString(),
        this.context.workspaceId,
        id,
      )
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

  public async listAccounts(input: {
    query?: string;
    limit?: number;
  }): Promise<AccountSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const params: Array<string | number> = [this.context.workspaceId];
    const conditions = ["co.workspace_id = ?"];
    if (input.query) {
      const query = `%${escapeLike(input.query)}%`;
      conditions.push(
        "(co.name LIKE ? ESCAPE '\\' OR co.domain LIKE ? ESCAPE '\\')",
      );
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
      .bind(
        id,
        this.context.workspaceId,
        input.name,
        input.domain?.toLowerCase() ?? null,
        now,
        now,
      )
      .run();
    const account = await this.getAccount(id);
    if (!account) throw new Error("Created account could not be loaded");
    return account;
  }

  public async updateAccount(
    id: string,
    input: AccountUpdate,
  ): Promise<Account | null> {
    const existing = await this.getAccount(id);
    if (!existing) return null;
    await this.database
      .prepare(
        `UPDATE companies SET name = ?, domain = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .bind(
        input.name ?? existing.name,
        input.domain === undefined
          ? existing.domain
          : input.domain?.toLowerCase() ?? null,
        new Date().toISOString(),
        this.context.workspaceId,
        id,
      )
      .run();
    return this.getAccount(id);
  }
}

export async function resolveMemberContext(
  database: DatabaseSource,
  userId: string,
  requestedOrganizationId: string | null,
): Promise<WorkspaceContext | null> {
  const row = await createDatabase(database)
    .prepare(
      `SELECT organization_id, role FROM member
       WHERE user_id = ? ${requestedOrganizationId ? "AND organization_id = ?" : ""}
       ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(...(requestedOrganizationId ? [userId, requestedOrganizationId] : [userId]))
    .first<{ organization_id: string; role: string }>();
  if (!row || !isWorkspaceRole(row.role)) return null;
  return { workspaceId: row.organization_id, userId, role: row.role };
}

export async function writeAuditLog(
  database: DatabaseSource,
  context: WorkspaceContext,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<void> {
  await createDatabase(database)
    .prepare(
      `INSERT INTO audit_logs (
        id, workspace_id, actor_user_id, api_key_id, action, resource_type,
        resource_id, metadata, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuidv7(),
      context.workspaceId,
      context.userId,
      context.apiKeyId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ipAddress ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  const drizzle = createDatabase(database);
  const candidates = await drizzle
    .prepare(
      `SELECT id FROM campaign_jobs
       WHERE status = 'pending' AND due_at <= ? AND (lease_until IS NULL OR lease_until < ?)
         ${workspaceId ? "AND workspace_id = ?" : ""}
       ORDER BY due_at ASC LIMIT ?`,
    )
    .bind(...(workspaceId ? [now, now, workspaceId, limit] : [now, now, limit]))
    .all<{ id: string }>();
  const claimed: Array<{ id: string; leaseId: string }> = [];
  for (const candidate of candidates.results) {
    const leaseId = uuidv7();
    const result = await drizzle
      .prepare(
        `UPDATE campaign_jobs SET status = 'leased', lease_id = ?, lease_until = ?, updated_at = ?
         WHERE id = ? AND status = 'pending' AND (lease_until IS NULL OR lease_until < ?)`,
      )
      .bind(leaseId, leaseUntil, now, candidate.id, now)
      .run();
    if (result.meta.changes === 1) claimed.push({ id: candidate.id, leaseId });
  }
  return claimed;
}

export async function reserveIdempotencyKey(
  database: DatabaseSource,
  workspaceId: string,
  scope: string,
  key: string,
  expiresAt: string,
): Promise<boolean> {
  const result = await createDatabase(database)
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys
       (workspace_id, scope, idempotency_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(workspaceId, scope, key, new Date().toISOString(), expiresAt)
    .run();
  return result.meta.changes === 1;
}

export function uuidv7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return ["owner", "admin", "marketer", "analyst", "viewer"].includes(value);
}

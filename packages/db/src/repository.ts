import type {
  Contact,
  ContactCreate,
  ContactUpdate,
  WorkspaceContext,
  WorkspaceRole,
} from "@kaenma/shared";

export interface CursorPage<T> {
  items: T[];
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
  custom_fields: string;
  created_at: string;
  updated_at: string;
}

export class WorkspaceRepository {
  public constructor(
    private readonly database: D1Database,
    public readonly context: WorkspaceContext,
  ) {}

  public async listContacts(input: {
    cursor?: string;
    limit?: number;
    query?: string;
  }): Promise<CursorPage<Contact>> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const params: Array<string | number> = [this.context.workspaceId];
    let cursorSql = "";
    let querySql = "";

    if (input.cursor) {
      cursorSql = "AND c.id < ?";
      params.push(input.cursor);
    }
    if (input.query) {
      querySql =
        "AND (c.email LIKE ? ESCAPE '\\' OR c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\')";
      const query = `%${escapeLike(input.query)}%`;
      params.push(query, query, query);
    }

    params.push(limit + 1);
    const result = await this.database
      .prepare(
        `SELECT c.* FROM contacts c
         WHERE c.workspace_id = ? ${cursorSql} ${querySql}
         ORDER BY c.id DESC LIMIT ?`,
      )
      .bind(...params)
      .all<ContactRow>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toContact);
    const last = items.at(-1);
    return {
      items,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'lead', 0, 'active', ?, ?, ?)`,
      )
      .bind(
        id,
        this.context.workspaceId,
        input.email?.toLowerCase() ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        input.phone ?? null,
        input.externalId ?? null,
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
      customFields:
        input.customFields === undefined ? existing.customFields : input.customFields,
    };
    await this.database
      .prepare(
        `UPDATE contacts SET email = ?, first_name = ?, last_name = ?, phone = ?,
         external_id = ?, custom_fields = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .bind(
        fields.email,
        fields.firstName,
        fields.lastName,
        fields.phone,
        fields.externalId,
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
        "UPDATE contacts SET status = 'archived', updated_at = ? WHERE workspace_id = ? AND id = ?",
      )
      .bind(new Date().toISOString(), this.context.workspaceId, id)
      .run();
    return result.meta.changes > 0;
  }
}

export async function resolveMemberContext(
  database: D1Database,
  userId: string,
  requestedOrganizationId: string | null,
): Promise<WorkspaceContext | null> {
  const row = await database
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
  database: D1Database,
  context: WorkspaceContext,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  },
): Promise<void> {
  await database
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
  database: D1Database,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  const candidates = await database
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
    const result = await database
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
  database: D1Database,
  workspaceId: string,
  scope: string,
  key: string,
  expiresAt: string,
): Promise<boolean> {
  const result = await database
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

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return ["owner", "admin", "marketer", "analyst", "viewer"].includes(value);
}

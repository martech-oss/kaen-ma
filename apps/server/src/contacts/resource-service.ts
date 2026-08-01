import {
  ContactRepository,
  uuidv7,
  type DrizzleRawStatement,
  type KaenmaDatabase,
} from "@kaenma/database";
import type {
  Contact,
  ContactBulkAction,
  ContactListCreate,
  ContactOptions,
  ContactProfile,
  ContactScoreAdjust,
  TagCreate,
  WorkspaceContext,
} from "@kaenma/shared";
import type { SegmentFilter } from "@kaenma/shared/segments";

import { recordContactEvent } from "../events/service";
import { resourceSlug } from "../http/helpers";
import { updateSegmentMemberCount } from "../segments/routes";
import {
  nullablePrimitiveString,
  numericValue,
  parseJsonRecord,
  parseJsonValue,
  primitiveString,
} from "../values";

/** A resource name already taken within the workspace. */
export class ResourceConflictError extends Error {
  public constructor(public readonly resource: "tag" | "list") {
    super(`${resource} already exists`);
    this.name = "ResourceConflictError";
  }
}

function parseFilterAst(value: unknown): SegmentFilter | null {
  return parseJsonValue<SegmentFilter | null>(value, null);
}

export async function getContactOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<ContactOptions> {
  const workspaceId = workspace.workspaceId;
  const results = await database.batch([
    database
      .prepare(
        `SELECT t.id, t.name, t.slug, t.color, COUNT(ct.contact_id) AS contact_count
         FROM tags t
         LEFT JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         WHERE t.workspace_id = ?
         GROUP BY t.id ORDER BY t.name`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT cl.id, cl.name, cl.slug, cl.description, cl.color,
                COUNT(CASE WHEN clm.status = 'active' THEN 1 END) AS contact_count
         FROM contact_lists cl
         LEFT JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         WHERE cl.workspace_id = ?
         GROUP BY cl.id ORDER BY cl.name`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT id, name, slug, kind, filter_ast, member_count, evaluated_at
         FROM segments WHERE workspace_id = ? ORDER BY name`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT stage, COUNT(*) AS contact_count
         FROM contacts
         WHERE workspace_id = ? AND status != 'archived'
         GROUP BY stage ORDER BY stage`,
      )
      .bind(workspaceId),
    database
      .prepare(
        `SELECT co.id, co.name, co.domain,
                COUNT(CASE WHEN c.status != 'archived' THEN 1 END) AS contact_count
         FROM companies co
         LEFT JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         LEFT JOIN contacts c
           ON c.workspace_id = cc.workspace_id AND c.id = cc.contact_id
         WHERE co.workspace_id = ?
         GROUP BY co.id ORDER BY co.name`,
      )
      .bind(workspaceId),
  ]);
  const rows = (index: number) => (results[index]?.results ?? []) as Record<string, unknown>[];
  return {
    tags: rows(0).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      slug: primitiveString(row["slug"]),
      color: primitiveString(row["color"]),
      contactCount: numericValue(row["contact_count"]),
    })),
    lists: rows(1).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      slug: primitiveString(row["slug"]),
      description: primitiveString(row["description"]),
      color: primitiveString(row["color"]),
      contactCount: numericValue(row["contact_count"]),
    })),
    segments: rows(2).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      slug: primitiveString(row["slug"]),
      kind: row["kind"] === "dynamic" ? "dynamic" : "static",
      filterAst: parseFilterAst(row["filter_ast"]),
      memberCount: numericValue(row["member_count"]),
      evaluatedAt: nullablePrimitiveString(row["evaluated_at"]),
    })),
    accounts: rows(4).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      domain: nullablePrimitiveString(row["domain"]),
      contactCount: numericValue(row["contact_count"]),
    })),
    stages: rows(3).map((row) => ({
      stage: primitiveString(row["stage"]),
      contactCount: numericValue(row["contact_count"]),
    })),
  };
}

export async function getContactProfile(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  contactId: string,
): Promise<ContactProfile | null> {
  const contact = await new ContactRepository(database, workspace).getContact(contactId);
  if (!contact) return null;
  const workspaceId = workspace.workspaceId;
  const results = await database.batch([
    database
      .prepare(
        `SELECT t.id, t.name, t.slug, t.color
         FROM tags t JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         WHERE ct.workspace_id = ? AND ct.contact_id = ?
         ORDER BY t.name`,
      )
      .bind(workspaceId, contactId),
    database
      .prepare(
        `SELECT cl.id, cl.name, cl.slug, cl.color, clm.status, clm.updated_at
         FROM contact_lists cl JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         WHERE clm.workspace_id = ? AND clm.contact_id = ?
         ORDER BY cl.name`,
      )
      .bind(workspaceId, contactId),
    database
      .prepare(
        `SELECT s.id, s.name, s.kind, sm.source, sm.joined_at
         FROM segments s JOIN segment_memberships sm
           ON sm.workspace_id = s.workspace_id AND sm.segment_id = s.id
         WHERE sm.workspace_id = ? AND sm.contact_id = ?
         ORDER BY s.name`,
      )
      .bind(workspaceId, contactId),
    database
      .prepare(
        `SELECT co.id, co.name, co.domain, cc.title, cc.is_primary
         FROM companies co JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         WHERE cc.workspace_id = ? AND cc.contact_id = ?
         ORDER BY cc.is_primary DESC, co.name`,
      )
      .bind(workspaceId, contactId),
    database
      .prepare(
        `SELECT id, delta, total, reason, created_at
         FROM score_events
         WHERE workspace_id = ? AND contact_id = ?
         ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(workspaceId, contactId),
    database
      .prepare(
        `SELECT id, type, resource_type, resource_id, properties, occurred_at
         FROM contact_events
         WHERE workspace_id = ? AND contact_id = ?
         ORDER BY occurred_at DESC, id DESC LIMIT 100`,
      )
      .bind(workspaceId, contactId),
  ]);
  const rows = (index: number) => (results[index]?.results ?? []) as Record<string, unknown>[];
  return {
    contact,
    tags: rows(0).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      slug: primitiveString(row["slug"]),
      color: primitiveString(row["color"]),
    })),
    lists: rows(1).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      slug: primitiveString(row["slug"]),
      color: primitiveString(row["color"]),
      status: primitiveString(row["status"]),
      updatedAt: primitiveString(row["updated_at"]),
    })),
    segments: rows(2).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      kind: row["kind"] === "dynamic" ? "dynamic" : "static",
      source: primitiveString(row["source"]),
      joinedAt: primitiveString(row["joined_at"]),
    })),
    accounts: rows(3).map((row) => ({
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      domain: nullablePrimitiveString(row["domain"]),
      title: nullablePrimitiveString(row["title"]),
      isPrimary: Boolean(row["is_primary"]),
    })),
    scoreEvents: rows(4).map((row) => ({
      id: primitiveString(row["id"]),
      delta: numericValue(row["delta"]),
      total: numericValue(row["total"]),
      reason: primitiveString(row["reason"]),
      createdAt: primitiveString(row["created_at"]),
    })),
    timeline: rows(5).map((row) => ({
      id: primitiveString(row["id"]),
      type: primitiveString(row["type"]),
      resourceType: nullablePrimitiveString(row["resource_type"]),
      resourceId: nullablePrimitiveString(row["resource_id"]),
      properties: parseJsonRecord(row["properties"]),
      occurredAt: primitiveString(row["occurred_at"]),
    })),
  };
}

export async function createTag(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: TagCreate,
): Promise<{ id: string; name: string; slug: string; color: string }> {
  const id = uuidv7();
  const slug = resourceSlug(input.name, id);
  try {
    await database
      .prepare(
        `INSERT INTO tags (id, workspace_id, name, slug, color, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, workspace.workspaceId, input.name, slug, input.color, new Date().toISOString())
      .run();
  } catch {
    throw new ResourceConflictError("tag");
  }
  return { id, slug, name: input.name, color: input.color };
}

export async function createContactList(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: ContactListCreate,
): Promise<{ id: string; name: string; slug: string; description: string; color: string }> {
  const id = uuidv7();
  const slug = resourceSlug(input.name, id);
  const now = new Date().toISOString();
  try {
    await database
      .prepare(
        `INSERT INTO contact_lists
         (id, workspace_id, name, slug, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, workspace.workspaceId, input.name, slug, input.description, input.color, now, now)
      .run();
  } catch {
    throw new ResourceConflictError("list");
  }
  return { id, slug, name: input.name, description: input.description, color: input.color };
}

export async function addContactTag(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  const result = await database
    .prepare(
      `INSERT OR IGNORE INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
       SELECT c.workspace_id, c.id, t.id, ?
       FROM contacts c JOIN tags t ON t.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived' AND t.id = ?`,
    )
    .bind(new Date().toISOString(), workspace.workspaceId, input.contactId, input.resourceId)
    .run();
  return result.meta.changes > 0;
}

export async function removeContactTag(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  const result = await database
    .prepare(
      `DELETE FROM contact_tags
       WHERE workspace_id = ? AND contact_id = ? AND tag_id = ?
         AND EXISTS (
           SELECT 1 FROM contacts c
           WHERE c.workspace_id = contact_tags.workspace_id
             AND c.id = contact_tags.contact_id AND c.status != 'archived'
         )`,
    )
    .bind(workspace.workspaceId, input.contactId, input.resourceId)
    .run();
  return result.meta.changes > 0;
}

export async function addContactList(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `INSERT INTO contact_list_memberships
       (workspace_id, list_id, contact_id, status, source, created_at, updated_at)
       SELECT c.workspace_id, cl.id, c.id, 'active', 'manual', ?, ?
       FROM contacts c JOIN contact_lists cl ON cl.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived' AND cl.id = ?
       ON CONFLICT(workspace_id, list_id, contact_id)
       DO UPDATE SET status = 'active', source = 'manual', updated_at = excluded.updated_at`,
    )
    .bind(now, now, workspace.workspaceId, input.contactId, input.resourceId)
    .run();
  return result.meta.changes > 0;
}

export async function removeContactList(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  const result = await database
    .prepare(
      `DELETE FROM contact_list_memberships
       WHERE workspace_id = ? AND contact_id = ? AND list_id = ?
         AND EXISTS (
           SELECT 1 FROM contacts c
           WHERE c.workspace_id = contact_list_memberships.workspace_id
             AND c.id = contact_list_memberships.contact_id AND c.status != 'archived'
         )`,
    )
    .bind(workspace.workspaceId, input.contactId, input.resourceId)
    .run();
  return result.meta.changes > 0;
}

export async function addContactSegment(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  const workspaceId = workspace.workspaceId;
  const result = await database
    .prepare(
      `INSERT OR IGNORE INTO segment_memberships
       (workspace_id, segment_id, contact_id, source, joined_at)
       SELECT c.workspace_id, s.id, c.id, 'static', ?
       FROM contacts c JOIN segments s ON s.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived'
         AND s.id = ? AND s.kind = 'static'`,
    )
    .bind(new Date().toISOString(), workspaceId, input.contactId, input.resourceId)
    .run();
  if (result.meta.changes === 0) return false;
  await updateSegmentMemberCount(database, workspaceId, input.resourceId);
  await recordContactEvent(database, {
    workspaceId,
    contactId: input.contactId,
    type: "segment_joined",
    resourceType: "segment",
    resourceId: input.resourceId,
  });
  return true;
}

export async function removeContactSegment(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<void> {
  const workspaceId = workspace.workspaceId;
  const result = await database
    .prepare(
      `DELETE FROM segment_memberships
       WHERE workspace_id = ? AND contact_id = ? AND segment_id = ? AND source = 'static'
         AND EXISTS (
           SELECT 1 FROM contacts c
           WHERE c.workspace_id = segment_memberships.workspace_id
             AND c.id = segment_memberships.contact_id AND c.status != 'archived'
         )`,
    )
    .bind(workspaceId, input.contactId, input.resourceId)
    .run();
  if (result.meta.changes > 0) {
    await updateSegmentMemberCount(database, workspaceId, input.resourceId);
  }
}

export async function adjustContactScore(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  contactId: string,
  input: ContactScoreAdjust,
): Promise<Contact | null> {
  const workspaceId = workspace.workspaceId;
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE contacts SET score = score + ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
    .bind(input.delta, now, workspaceId, contactId)
    .run();
  if (result.meta.changes === 0) return null;
  await database
    .prepare(
      `INSERT INTO score_events
       (id, workspace_id, contact_id, delta, total, reason, created_at)
       SELECT ?, workspace_id, id, ?, score, ?, ?
       FROM contacts WHERE workspace_id = ? AND id = ?`,
    )
    .bind(uuidv7(), input.delta, input.reason, now, workspaceId, contactId)
    .run();
  return new ContactRepository(database, workspace).getContact(contactId);
}

export function restoreContact(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  contactId: string,
): Promise<boolean> {
  return new ContactRepository(database, workspace).restoreContact(contactId);
}

export type BulkActionOutcome =
  | { kind: "archive_forbidden" }
  | { kind: "resource_required" }
  | { kind: "ok"; updated: number };

/**
 * Applies one action to up to 100 contacts in a single statement. Archive and
 * restore need admin, because they are destructive across many records at once.
 */
export async function applyContactBulkAction(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: ContactBulkAction,
): Promise<BulkActionOutcome> {
  const isArchival = input.action === "archive" || input.action === "restore";
  if (isArchival && !["admin", "owner"].includes(workspace.role)) {
    return { kind: "archive_forbidden" };
  }
  if (!isArchival && !input.resourceId) return { kind: "resource_required" };

  const workspaceId = workspace.workspaceId;
  const contactIds = [...new Set(input.contactIds)];
  const placeholders = contactIds.map(() => "?").join(", ");
  const now = new Date().toISOString();
  let statement: DrizzleRawStatement;
  if (isArchival) {
    const archived = input.action === "archive";
    statement = database
      .prepare(
        `UPDATE contacts
         SET status = ?, archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id IN (${placeholders})`,
      )
      .bind(
        archived ? "archived" : "active",
        archived ? now : null,
        now,
        workspaceId,
        ...contactIds,
      );
  } else if (input.action === "add_tag") {
    statement = database
      .prepare(
        `INSERT OR IGNORE INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
         SELECT c.workspace_id, c.id, t.id, ?
         FROM contacts c JOIN tags t ON t.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.status != 'archived'
           AND c.id IN (${placeholders}) AND t.id = ?`,
      )
      .bind(now, workspaceId, ...contactIds, input.resourceId);
  } else if (input.action === "remove_tag") {
    statement = database
      .prepare(
        `DELETE FROM contact_tags
         WHERE workspace_id = ? AND contact_id IN (${placeholders}) AND tag_id = ?
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = contact_tags.workspace_id
               AND c.id = contact_tags.contact_id AND c.status != 'archived'
           )`,
      )
      .bind(workspaceId, ...contactIds, input.resourceId);
  } else if (input.action === "add_list") {
    statement = database
      .prepare(
        `INSERT INTO contact_list_memberships
         (workspace_id, list_id, contact_id, status, source, created_at, updated_at)
         SELECT c.workspace_id, cl.id, c.id, 'active', 'bulk', ?, ?
         FROM contacts c JOIN contact_lists cl ON cl.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.status != 'archived'
           AND c.id IN (${placeholders}) AND cl.id = ?
         ON CONFLICT(workspace_id, list_id, contact_id)
         DO UPDATE SET status = 'active', source = 'bulk', updated_at = excluded.updated_at`,
      )
      .bind(now, now, workspaceId, ...contactIds, input.resourceId);
  } else {
    statement = database
      .prepare(
        `DELETE FROM contact_list_memberships
         WHERE workspace_id = ? AND contact_id IN (${placeholders}) AND list_id = ?
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = contact_list_memberships.workspace_id
               AND c.id = contact_list_memberships.contact_id AND c.status != 'archived'
           )`,
      )
      .bind(workspaceId, ...contactIds, input.resourceId);
  }
  const result = await statement.run();
  return { kind: "ok", updated: result.meta.changes };
}

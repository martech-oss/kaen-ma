import {
  ContactRepository,
  ContactResourceRepository,
  uuidv7,
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
} from "@kaenma/orpc";

import { recordContactEvent } from "../contacts/event-service";
import { resourceSlug } from "../platform/values";
import { updateSegmentMemberCount } from "../segments/membership-service";

/** A resource name already taken within the workspace. */
export class ResourceConflictError extends Error {
  public constructor(public readonly resource: "tag" | "list") {
    super(`${resource} already exists`);
    this.name = "ResourceConflictError";
  }
}

export async function getContactOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<ContactOptions> {
  const rows = await new ContactResourceRepository(database, workspace).getContactOptionRows();
  return {
    tags: rows.tags,
    lists: rows.lists,
    segments: rows.segments.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind === "dynamic" ? "dynamic" : "static",
      filterAst: row.filterAst,
      memberCount: row.memberCount,
      evaluatedAt: row.evaluatedAt,
    })),
    accounts: rows.accounts,
    stages: rows.stages,
  };
}

export async function getContactProfile(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  contactId: string,
): Promise<ContactProfile | null> {
  const contact = await new ContactRepository(database, workspace).getContact(contactId);
  if (!contact) return null;
  const rows = await new ContactResourceRepository(database, workspace).getContactProfileRows(
    contactId,
  );
  return {
    contact,
    tags: rows.tags,
    lists: rows.lists,
    segments: rows.segments.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind === "dynamic" ? "dynamic" : "static",
      source: row.source,
      joinedAt: row.joinedAt,
    })),
    accounts: rows.accounts.map((row) => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      title: row.title,
      isPrimary: Boolean(row.isPrimary),
    })),
    scoreEvents: rows.scoreEvents,
    timeline: rows.timeline,
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
    await new ContactResourceRepository(database, workspace).createTag({
      id,
      slug,
      name: input.name,
      color: input.color,
    });
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
  try {
    await new ContactResourceRepository(database, workspace).createContactList({
      id,
      slug,
      name: input.name,
      description: input.description,
      color: input.color,
    });
  } catch {
    throw new ResourceConflictError("list");
  }
  return { id, slug, name: input.name, description: input.description, color: input.color };
}

export function addContactTag(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  return new ContactResourceRepository(database, workspace).addContactTag(
    input.contactId,
    input.resourceId,
  );
}

export function removeContactTag(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  return new ContactResourceRepository(database, workspace).removeContactTag(
    input.contactId,
    input.resourceId,
  );
}

export function addContactList(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  return new ContactResourceRepository(database, workspace).addContactList(
    input.contactId,
    input.resourceId,
  );
}

export function removeContactList(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  return new ContactResourceRepository(database, workspace).removeContactList(
    input.contactId,
    input.resourceId,
  );
}

export async function addContactSegment(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { contactId: string; resourceId: string },
): Promise<boolean> {
  const workspaceId = workspace.workspaceId;
  const added = await new ContactResourceRepository(database, workspace).addContactSegment(
    input.contactId,
    input.resourceId,
  );
  if (!added) return false;
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
  const removed = await new ContactResourceRepository(database, workspace).removeContactSegment(
    input.contactId,
    input.resourceId,
  );
  if (removed) {
    await updateSegmentMemberCount(database, workspace.workspaceId, input.resourceId);
  }
}

export async function adjustContactScore(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  contactId: string,
  input: ContactScoreAdjust,
): Promise<Contact | null> {
  const adjusted = await new ContactResourceRepository(database, workspace).adjustContactScore(
    contactId,
    input,
  );
  if (!adjusted) return null;
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
  const repository = new ContactResourceRepository(database, workspace);
  if (input.action === "archive" || input.action === "restore") {
    if (!["admin", "owner"].includes(workspace.role)) return { kind: "archive_forbidden" };
    const contactIds = [...new Set(input.contactIds)];
    const updated = await repository.bulkSetContactsArchived(
      contactIds,
      input.action === "archive",
    );
    return { kind: "ok", updated };
  }
  const resourceId = input.resourceId;
  if (!resourceId) return { kind: "resource_required" };
  const contactIds = [...new Set(input.contactIds)];
  let updated: number;
  if (input.action === "add_tag") {
    updated = await repository.bulkAddContactTag(contactIds, resourceId);
  } else if (input.action === "remove_tag") {
    updated = await repository.bulkRemoveContactTag(contactIds, resourceId);
  } else if (input.action === "add_list") {
    updated = await repository.bulkAddContactList(contactIds, resourceId);
  } else {
    updated = await repository.bulkRemoveContactList(contactIds, resourceId);
  }
  return { kind: "ok", updated };
}

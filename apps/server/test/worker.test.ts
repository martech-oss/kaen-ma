import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ContactRepository, reserveIdempotencyKey, uuidv7 } from "@kaenma/database";
import { contract } from "@kaenma/orpc";

import { isEmailVerificationRequired, resolveAuthBaseURL } from "../src/auth/service";
import { sha256Hex } from "../src/platform/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("Kaenma Worker", () => {
  it("uses the actual localhost port for Better Auth during development", () => {
    expect(
      resolveAuthBaseURL(
        { APP_URL: "http://localhost:8787", ENVIRONMENT: "development" },
        "http://localhost:8788",
      ),
    ).toBe("http://localhost:8788");
    expect(
      resolveAuthBaseURL(
        { APP_URL: "https://app.example.com", ENVIRONMENT: "production" },
        "https://evil.example.com",
      ),
    ).toBe("https://app.example.com");
  });

  it("skips email verification only in development", () => {
    expect(isEmailVerificationRequired("development")).toBe(false);
    expect(isEmailVerificationRequired("test")).toBe(true);
    expect(isEmailVerificationRequired("production")).toBe(true);
  });

  it("reports a healthy migrated D1 database", async () => {
    const response = await exports.default.fetch("http://localhost:8787/api/health");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { status: string; migrations: number } };
    expect(payload.data.status).toBe("ok");
    expect(payload.data.migrations).toBeGreaterThan(0);
  });

  it("never returns a contact from another workspace by direct ID", async () => {
    const firstWorkspace = uuidv7();
    const secondWorkspace = uuidv7();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'First', 'first', ?, 'UTC')`,
      ).bind(firstWorkspace, now),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Second', 'second', ?, 'UTC')`,
      ).bind(secondWorkspace, now),
    ]);
    const first = new ContactRepository(env.DB, {
      workspaceId: firstWorkspace,
      userId: "user-one",
      role: "owner",
    });
    const second = new ContactRepository(env.DB, {
      workspaceId: secondWorkspace,
      userId: "user-two",
      role: "owner",
    });
    const contact = await first.createContact({
      email: "person@example.com",
      customFields: {},
    });
    expect(await first.getContact(contact.id)).not.toBeNull();
    expect(await second.getContact(contact.id)).toBeNull();
  });

  it("filters, paginates, archives, and restores contacts within a workspace", async () => {
    const workspaceId = uuidv7();
    const tagId = uuidv7();
    const listId = uuidv7();
    const accountId = uuidv7();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Contacts Workspace', ?, ?, 'UTC')`,
    )
      .bind(workspaceId, `contacts-${workspaceId}`, Date.now())
      .run();
    const repository = new ContactRepository(env.DB, {
      workspaceId,
      userId: "contacts-owner",
      role: "owner",
    });
    const highScore = await repository.createContact({
      email: "high@example.com",
      firstName: "High",
      stage: "customer",
      customFields: {},
    });
    const lowScore = await repository.createContact({
      email: "low@example.com",
      firstName: "Low",
      stage: "lead",
      customFields: {},
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tags (id, workspace_id, name, slug, color, created_at)
         VALUES (?, ?, 'VIP', ?, '#6366f1', ?)`,
      ).bind(tagId, workspaceId, `vip-${tagId}`, now),
      env.DB.prepare(
        `INSERT INTO contact_lists
         (id, workspace_id, name, slug, description, color, created_at, updated_at)
         VALUES (?, ?, 'Customers', ?, '', '#6366f1', ?, ?)`,
      ).bind(listId, workspaceId, `customers-${listId}`, now, now),
      env.DB.prepare(
        `INSERT INTO companies
         (id, workspace_id, name, domain, custom_fields, created_at, updated_at)
         VALUES (?, ?, 'Acme', 'acme.example', '{}', ?, ?)`,
      ).bind(accountId, workspaceId, now, now),
      env.DB.prepare("UPDATE contacts SET score = 80 WHERE workspace_id = ? AND id = ?").bind(
        workspaceId,
        highScore.id,
      ),
      env.DB.prepare("UPDATE contacts SET score = 10 WHERE workspace_id = ? AND id = ?").bind(
        workspaceId,
        lowScore.id,
      ),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(workspaceId, highScore.id, tagId, now),
      env.DB.prepare(
        `INSERT INTO contact_list_memberships
         (workspace_id, list_id, contact_id, status, source, created_at, updated_at)
         VALUES (?, ?, ?, 'active', 'manual', ?, ?)`,
      ).bind(workspaceId, listId, highScore.id, now, now),
      env.DB.prepare(
        `INSERT INTO company_contacts
         (workspace_id, company_id, contact_id, title, is_primary, created_at)
         VALUES (?, ?, ?, 'Owner', 1, ?)`,
      ).bind(workspaceId, accountId, highScore.id, now),
    ]);

    const filtered = await repository.listContacts({
      tagId,
      listId,
      accountId,
      stage: "customer",
      scoreMin: 50,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.items.map((contact) => contact.id)).toEqual([highScore.id]);

    const firstPage = await repository.listContacts({
      limit: 1,
      sort: "score",
      direction: "desc",
    });
    expect(firstPage.total).toBe(2);
    expect(firstPage.items[0]?.id).toBe(highScore.id);
    expect(firstPage.nextCursor).toBe(highScore.id);
    const secondPage = await repository.listContacts({
      cursor: firstPage.nextCursor,
      limit: 1,
      sort: "score",
      direction: "desc",
    });
    expect(secondPage.total).toBe(2);
    expect(secondPage.items[0]?.id).toBe(lowScore.id);

    expect(await repository.archiveContact(highScore.id)).toBe(true);
    expect((await repository.listContacts({})).items.map((contact) => contact.id)).toEqual([
      lowScore.id,
    ]);
    const archived = await repository.listContacts({ status: "archived" });
    expect(archived.items[0]?.archivedAt).not.toBeNull();
    expect(await repository.restoreContact(highScore.id)).toBe(true);
    expect((await repository.listContacts({})).total).toBe(2);
  });

  it("manages the full contact profile through authenticated API routes", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const apiKeyId = uuidv7();
    const prefix = "contactstest";
    const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user
         (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'Contacts Owner', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'API Contacts Workspace', ?, ?, 'UTC')`,
      ).bind(workspaceId, `api-contacts-${workspaceId}`, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'Contacts test', ?, ?, 'owner', ?)`,
      ).bind(apiKeyId, workspaceId, userId, prefix, await sha256Hex(token), now),
    ]);
    const link = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      headers: { authorization: `Bearer ${token}` },
      fetch: (request) => exports.default.fetch(request),
    });
    const client: ContractRouterClient<typeof contract> = createORPCClient(link);

    const tag = await client.contactResources.createTag({ name: "VIP", color: "#6366f1" });
    expect(tag.id).toBeTruthy();
    const list = await client.contactResources.createList({
      name: "Customers",
      description: "Paid customers",
    });
    expect(list.id).toBeTruthy();
    const account = await client.accounts.create({ name: "Acme", domain: "acme.example" });
    expect(account.name).toBe("Acme");

    const contact = await client.contacts.create({
      email: "api-contact@example.com",
      firstName: "API",
      stage: "customer",
      customFields: {},
    });
    await expect(
      client.contactResources.addTag({ contactId: contact.id, resourceId: tag.id }),
    ).resolves.toEqual({ assigned: true });
    await expect(
      client.contactResources.addList({ contactId: contact.id, resourceId: list.id }),
    ).resolves.toEqual({ assigned: true });
    await expect(
      client.accounts.assignContact({
        id: account.id,
        contactId: contact.id,
        title: "Marketing Lead",
        isPrimary: true,
      }),
    ).resolves.toEqual({ assigned: true });
    const scored = await client.contactResources.adjustScore({
      contactId: contact.id,
      delta: 75,
      reason: "Qualified lead",
    });
    expect(scored.score).toBe(75);

    const segment = await client.segments.create({
      name: "Tokyo VIP",
      slug: "tokyo-vip",
      kind: "dynamic",
      filter: {
        kind: "group",
        combinator: "and",
        children: [
          { kind: "condition", field: "tag", operator: "eq", value: tag.slug },
          { kind: "condition", field: "list", operator: "eq", value: list.slug },
          { kind: "condition", field: "score", operator: "gte", value: 50 },
        ],
      },
    });
    expect(segment.id).toBeTruthy();

    const variable = await client.emails.createVariable({
      key: "brand_name",
      name: "Brand name",
      value: "Kaenma",
      description: "Shared brand label",
    });
    expect(variable.id).toBeTruthy();
    await expect(
      client.emails.updateVariable({
        id: variable.id,
        key: "brand_name",
        name: "Brand name",
        value: "Kaenma MA",
        description: "Updated shared brand label",
      }),
    ).resolves.toEqual({ updated: true });

    const templateId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO email_templates
       (id, workspace_id, name, purpose, resend_template_id, resend_alias, subject,
        remote_status, remote_current_version_id, has_unpublished_versions,
        variables, published_at, last_synced_at, created_at, updated_at)
       VALUES (?, ?, 'Welcome', 'marketing', ?, 'welcome', ?, 'published',
               'resend-version-id', 0, ?, ?, ?, ?, ?)`,
    )
      .bind(
        templateId,
        workspaceId,
        `resend-${templateId}`,
        "{{{MESSAGE_BRAND_NAME}}} update",
        JSON.stringify([
          { key: "MESSAGE_BRAND_NAME", type: "string", fallbackValue: null },
          { key: "KAENMA_UNSUBSCRIBE_URL", type: "string", fallbackValue: null },
        ]),
        now,
        now,
        now,
        now,
      )
      .run();
    const templates = await client.emails.listTemplates({ archived: false });
    expect(templates.find((template) => template.id === templateId)).toMatchObject({
      resendAlias: "welcome",
      subject: "{{{MESSAGE_BRAND_NAME}}} update",
      remoteStatus: "published",
      sendable: true,
    });

    const broadcast = await client.emails.createCampaign({
      name: "August update",
      segmentId: segment.id,
      templateId,
      topicId: null,
      scheduledAt: null,
    });
    await expect(
      client.emails.updateCampaign({
        id: broadcast.id,
        name: "August update edited",
        segmentId: segment.id,
        templateId,
        topicId: null,
        scheduledAt: null,
      }),
    ).resolves.toEqual({ updated: true });
    const broadcasts = await client.emails.listCampaigns({ archived: false });
    expect(broadcasts).toEqual([
      expect.objectContaining({
        id: broadcast.id,
        name: "August update edited",
        segmentName: "Tokyo VIP",
      }),
    ]);
    await expect(client.emails.archiveCampaign({ id: broadcast.id })).resolves.toEqual({
      archived: true,
    });
    const archivedBroadcasts = await client.emails.listCampaigns({ archived: true });
    expect(archivedBroadcasts).toEqual([expect.objectContaining({ id: broadcast.id })]);
    await expect(client.emails.archiveTemplate({ id: templateId })).resolves.toEqual({
      archived: true,
    });
    await expect(client.emails.archiveVariable({ id: variable.id })).resolves.toEqual({
      archived: true,
    });

    const filtered = await client.contacts.list({
      tagId: tag.id,
      listId: list.id,
      accountId: account.id,
      segmentId: segment.id,
      scoreMin: 50,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      id: contact.id,
      tags: [expect.objectContaining({ id: tag.id })],
      lists: [expect.objectContaining({ id: list.id })],
      accounts: [expect.objectContaining({ id: account.id })],
    });

    const profile = await client.contactResources.profile({ contactId: contact.id });
    expect(profile.contact.score).toBe(75);
    expect(profile.tags).toHaveLength(1);
    expect(profile.lists).toHaveLength(1);
    expect(profile.accounts).toHaveLength(1);
    expect(profile.scoreEvents).toHaveLength(1);

    const accountDetail = await client.accounts.get({ id: account.id });
    expect(accountDetail.name).toBe("Acme");
    expect(accountDetail.contacts).toEqual([
      expect.objectContaining({
        id: contact.id,
        title: "Marketing Lead",
      }),
    ]);

    await expect(client.contacts.archive({ id: contact.id })).resolves.toEqual({
      archived: true,
    });
    await expect(
      client.contacts.update({ id: contact.id, firstName: "Blocked" }),
    ).rejects.toMatchObject({ code: "CONTACT_ARCHIVED", status: 409 });
    await expect(
      client.contactResources.removeTag({ contactId: contact.id, resourceId: tag.id }),
    ).rejects.toMatchObject({ code: "RELATION_REJECTED", status: 409 });
    await expect(client.contactResources.restore({ contactId: contact.id })).resolves.toEqual({
      restored: true,
    });
    await expect(
      client.contactResources.removeTag({ contactId: contact.id, resourceId: tag.id }),
    ).resolves.toEqual({ removed: true });
  });

  it("reserves a delivery idempotency key only once", async () => {
    const workspaceId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Workspace', 'workspace', ?, 'UTC')`,
    )
      .bind(workspaceId, Date.now())
      .run();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(
      await reserveIdempotencyKey(env.DB, workspaceId, "delivery", "same-key", expiresAt),
    ).toBe(true);
    expect(
      await reserveIdempotencyKey(env.DB, workspaceId, "delivery", "same-key", expiresAt),
    ).toBe(false);
  });
});

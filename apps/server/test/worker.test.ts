import {
  companies,
  companyContacts,
  ContactRepository,
  contacts,
  contactTags,
  createDatabase,
  reserveIdempotencyKey,
  segmentMemberships,
  segments,
  tags,
  uuidv7,
} from "@openengage/database";
import { env, exports } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { isEmailVerificationRequired, resolveAuthBaseURL } from "../src/auth/service";
import { seedWorkspace, seedWorkspaceClient } from "./factory";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("OpenEngage Worker", () => {
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
    const { workspaceId: firstWorkspace } = await seedWorkspace(env.DB);
    const { workspaceId: secondWorkspace } = await seedWorkspace(env.DB);
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
    const { workspaceId } = await seedWorkspace(env.DB);
    const tagId = uuidv7();
    const segmentId = uuidv7();
    const accountId = uuidv7();
    const now = new Date().toISOString();
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
    const orm = createDatabase(env.DB).orm;
    await orm.batch([
      orm.insert(tags).values({
        id: tagId,
        workspaceId,
        name: "VIP",
        slug: `vip-${tagId}`,
        color: "#6366f1",
        createdAt: now,
      }),
      orm.insert(segments).values({
        id: segmentId,
        workspaceId,
        name: "Customers",
        slug: `customers-${segmentId}`,
        kind: "static",
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(companies).values({
        id: accountId,
        workspaceId,
        name: "Acme",
        domain: "acme.example",
        customFields: "{}",
        createdAt: now,
        updatedAt: now,
      }),
      orm
        .update(contacts)
        .set({ score: 80 })
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, highScore.id))),
      orm
        .update(contacts)
        .set({ score: 10 })
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, lowScore.id))),
    ]);
    await orm.batch([
      orm.insert(contactTags).values({
        workspaceId,
        contactId: highScore.id,
        tagId,
        createdAt: now,
      }),
      orm.insert(segmentMemberships).values({
        workspaceId,
        segmentId,
        contactId: highScore.id,
        source: "static",
        joinedAt: now,
      }),
      orm.insert(companyContacts).values({
        workspaceId,
        companyId: accountId,
        contactId: highScore.id,
        title: "Owner",
        isPrimary: true,
        createdAt: now,
      }),
    ]);

    const filtered = await repository.listContacts({
      tagId,
      segmentId,
      companyId: accountId,
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
    const { client, workspaceId } = await seedWorkspaceClient(env.DB);
    const now = new Date().toISOString();

    const tag = await client.contactResources.createTag({ name: "VIP", color: "#6366f1" });
    expect(tag.id).toBeTruthy();
    const group = await client.segments.create({
      name: "Customers",
      slug: "customers",
      kind: "static",
    });
    expect(group.id).toBeTruthy();
    const account = await client.companies.create({ name: "Acme", domain: "acme.example" });
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
      client.contactResources.addSegment({ contactId: contact.id, resourceId: group.id }),
    ).resolves.toEqual({ assigned: true });
    await expect(
      client.companies.assignContact({
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
          { kind: "condition", field: "segment", operator: "eq", value: group.slug },
          { kind: "condition", field: "score", operator: "gte", value: 50 },
        ],
      },
    });
    expect(segment.id).toBeTruthy();

    const variable = await client.emails.createVariable({
      key: "brand_name",
      name: "Brand name",
      value: "OpenEngage",
      description: "Shared brand label",
    });
    expect(variable.id).toBeTruthy();
    await expect(
      client.emails.updateVariable({
        id: variable.id,
        key: "brand_name",
        name: "Brand name",
        value: "OpenEngage MA",
        description: "Updated shared brand label",
      }),
    ).resolves.toEqual({ updated: true });

    const templateId = uuidv7();
    // raw seed: migrate in P6/P7 (email template row belongs to the messaging domain)
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
          { key: "OPENENGAGE_UNSUBSCRIBE_URL", type: "string", fallbackValue: null },
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
      companyId: account.id,
      segmentId: group.id,
      scoreMin: 50,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      id: contact.id,
      tags: [expect.objectContaining({ id: tag.id })],
      companies: [expect.objectContaining({ id: account.id })],
    });

    const profile = await client.contactResources.profile({ contactId: contact.id });
    expect(profile.contact.score).toBe(75);
    expect(profile.tags).toHaveLength(1);
    // Both the manually-added static group and the auto-refreshed dynamic
    // "Tokyo VIP" segment (created below, matching this contact's tag/group/
    // score) end up as memberships once the dynamic segment exists.
    expect(profile.segments.map((row) => row.id)).toContain(group.id);
    expect(profile.companies).toHaveLength(1);
    expect(profile.scoreEvents).toHaveLength(1);

    const accountDetail = await client.companies.get({ id: account.id });
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
    const { workspaceId } = await seedWorkspace(env.DB);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(
      await reserveIdempotencyKey(env.DB, workspaceId, "delivery", "same-key", expiresAt),
    ).toBe(true);
    expect(
      await reserveIdempotencyKey(env.DB, workspaceId, "delivery", "same-key", expiresAt),
    ).toBe(false);
  });
});

import { WorkspaceRepository, reserveIdempotencyKey, uuidv7 } from "@kaenma/db";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { isEmailVerificationRequired, resolveAuthBaseURL } from "../src/auth";
import { sha256Hex } from "../src/crypto";

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
    const first = new WorkspaceRepository(env.DB, {
      workspaceId: firstWorkspace,
      userId: "user-one",
      role: "owner",
    });
    const second = new WorkspaceRepository(env.DB, {
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
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Contacts Workspace', ?, ?, 'UTC')`,
    )
      .bind(workspaceId, `contacts-${workspaceId}`, Date.now())
      .run();
    const repository = new WorkspaceRepository(env.DB, {
      workspaceId,
      userId: "contacts-owner",
      role: "owner",
    });
    const highScore = await repository.createContact({
      email: "high@example.com",
      firstName: "High",
      stage: "customer",
      customFields: { region: "Tokyo" },
    });
    const lowScore = await repository.createContact({
      email: "low@example.com",
      firstName: "Low",
      stage: "lead",
      customFields: { region: "Osaka" },
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
        "UPDATE contacts SET score = 80 WHERE workspace_id = ? AND id = ?",
      ).bind(workspaceId, highScore.id),
      env.DB.prepare(
        "UPDATE contacts SET score = 10 WHERE workspace_id = ? AND id = ?",
      ).bind(workspaceId, lowScore.id),
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
    ]);

    const filtered = await repository.listContacts({
      tagId,
      listId,
      stage: "customer",
      scoreMin: 50,
      customFieldKey: "region",
      customFieldValue: "Tokyo",
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
    const call = (path: string, init?: RequestInit) =>
      exports.default.fetch(
        new Request(`http://localhost:8787/api/v1${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            ...init?.headers,
          },
        }),
      );

    const tagResponse = await call("/tags", {
      method: "POST",
      body: JSON.stringify({ name: "VIP", color: "#6366f1" }),
    });
    expect(tagResponse.status).toBe(201);
    const tag = (await tagResponse.json()) as { data: { id: string; slug: string } };
    const listResponse = await call("/contact-lists", {
      method: "POST",
      body: JSON.stringify({ name: "Customers", description: "Paid customers" }),
    });
    expect(listResponse.status).toBe(201);
    const list = (await listResponse.json()) as { data: { id: string; slug: string } };
    expect(
      (
        await call("/custom-fields", {
          method: "POST",
          body: JSON.stringify({
            key: "region",
            label: "地域",
            dataType: "select",
            options: ["Tokyo", "Osaka"],
          }),
        })
      ).status,
    ).toBe(201);

    const contactResponse = await call("/contacts", {
      method: "POST",
      body: JSON.stringify({
        email: "api-contact@example.com",
        firstName: "API",
        stage: "customer",
        customFields: { region: "Tokyo" },
      }),
    });
    expect(contactResponse.status).toBe(201);
    const contact = (await contactResponse.json()) as { data: { id: string } };
    expect(
      (
        await call(`/contacts/${contact.data.id}/tags`, {
          method: "POST",
          body: JSON.stringify({ tagId: tag.data.id }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(`/contacts/${contact.data.id}/lists`, {
          method: "POST",
          body: JSON.stringify({ listId: list.data.id }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(`/contacts/${contact.data.id}/score`, {
          method: "POST",
          body: JSON.stringify({ delta: 75, reason: "Qualified lead" }),
        })
      ).status,
    ).toBe(200);

    const segmentResponse = await call("/segments", {
      method: "POST",
      body: JSON.stringify({
        name: "Tokyo VIP",
        slug: "tokyo-vip",
        kind: "dynamic",
        filter: {
          kind: "group",
          combinator: "and",
          children: [
            { kind: "condition", field: "tag", operator: "eq", value: tag.data.slug },
            { kind: "condition", field: "list", operator: "eq", value: list.data.slug },
            { kind: "condition", field: "score", operator: "gte", value: 50 },
          ],
        },
      }),
    });
    expect(segmentResponse.status).toBe(201);
    const segment = (await segmentResponse.json()) as { data: { id: string } };

    const filteredResponse = await call(
      `/contacts?tagId=${tag.data.id}&listId=${list.data.id}&segmentId=${segment.data.id}` +
        "&scoreMin=50&customFieldKey=region&customFieldValue=Tokyo",
    );
    expect(filteredResponse.status).toBe(200);
    const filtered = (await filteredResponse.json()) as {
      data: Array<{ id: string; tags: unknown[]; lists: unknown[] }>;
      meta: { total: number };
    };
    expect(filtered.meta.total).toBe(1);
    expect(filtered.data[0]).toMatchObject({
      id: contact.data.id,
      tags: [expect.objectContaining({ id: tag.data.id })],
      lists: [expect.objectContaining({ id: list.data.id })],
    });

    const profileResponse = await call(`/contacts/${contact.data.id}/profile`);
    expect(profileResponse.status).toBe(200);
    const profile = (await profileResponse.json()) as {
      data: {
        contact: { score: number };
        tags: unknown[];
        lists: unknown[];
        scoreEvents: unknown[];
      };
    };
    expect(profile.data.contact.score).toBe(75);
    expect(profile.data.tags).toHaveLength(1);
    expect(profile.data.lists).toHaveLength(1);
    expect(profile.data.scoreEvents).toHaveLength(1);

    expect((await call(`/contacts/${contact.data.id}`, { method: "DELETE" })).status).toBe(200);
    expect(
      (
        await call(`/contacts/${contact.data.id}`, {
          method: "PATCH",
          body: JSON.stringify({ firstName: "Blocked" }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`/contacts/${contact.data.id}/tags/${tag.data.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(`/contacts/${contact.data.id}/restore`, { method: "POST" })).status,
    ).toBe(200);
    expect(
      (
        await call(`/contacts/${contact.data.id}/tags/${tag.data.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
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

  it("accepts Resend provider configuration with valid foreign keys", async () => {
    const workspaceId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Resend Workspace', 'resend-workspace', ?, 'UTC')`,
    )
      .bind(workspaceId, Date.now())
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO provider_configs
         (id, workspace_id, provider, name, encrypted_credentials, settings, created_at, updated_at)
         VALUES (?, ?, 'resend', 'default', 'encrypted', '{}', ?, ?)`,
      )
        .bind(uuidv7(), workspaceId, new Date().toISOString(), new Date().toISOString())
        .run(),
    ).resolves.toBeDefined();
    const foreignKeyViolations = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeyViolations.results).toEqual([]);
  });
});

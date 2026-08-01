import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { WorkspaceRole } from "@kaenma/orpc";

import { seedWorkspaceClient } from "./factory";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function seedWorkspace(role: WorkspaceRole = "owner") {
  const { client } = await seedWorkspaceClient(env.DB, { role, timezone: "Asia/Tokyo" });
  return client;
}

/**
 * These endpoints read snake_case columns and must publish camelCase. The
 * mapping is hand-written per column, so a typo cannot be caught by tsc --
 * only by asserting the values arrive populated.
 */
describe("contact resources over oRPC", () => {
  it("maps option rows to camelCase with counts", async () => {
    const client = await seedWorkspace();
    const tag = await client.contactResources.createTag({ name: "VIP", color: "#0f766e" });
    const list = await client.contactResources.createList({
      name: "Customers",
      description: "paying",
      color: "#6366f1",
    });
    const contact = await client.contacts.create({
      email: "res@example.com",
      stage: "customer",
      customFields: {},
    });
    await client.contactResources.addTag({ contactId: contact.id, resourceId: tag.id });
    await client.contactResources.addList({ contactId: contact.id, resourceId: list.id });

    const options = await client.contactResources.options();
    expect(options.tags).toEqual([
      { id: tag.id, name: "VIP", slug: tag.slug, color: "#0f766e", contactCount: 1 },
    ]);
    expect(options.lists).toEqual([
      {
        id: list.id,
        name: "Customers",
        slug: list.slug,
        description: "paying",
        color: "#6366f1",
        contactCount: 1,
      },
    ]);
    expect(options.stages).toEqual([{ stage: "customer", contactCount: 1 }]);
  });

  it("maps the profile to camelCase, including the account relation", async () => {
    const client = await seedWorkspace();
    const account = await client.accounts.create({ name: "Globex" });
    const contact = await client.contacts.create({ email: "p@example.com", customFields: {} });
    await client.accounts.assignContact({
      id: account.id,
      contactId: contact.id,
      title: "VP",
      isPrimary: true,
    });
    await client.contactResources.adjustScore({
      contactId: contact.id,
      delta: 5,
      reason: "signup",
    });

    const profile = await client.contactResources.profile({ contactId: contact.id });
    expect(profile.accounts).toEqual([
      { id: account.id, name: "Globex", domain: null, title: "VP", isPrimary: true },
    ]);
    expect(profile.scoreEvents).toEqual([
      expect.objectContaining({ delta: 5, total: 5, reason: "signup" }),
    ]);
    expect(profile.scoreEvents[0]?.createdAt).toEqual(expect.any(String));
    expect(profile.contact.score).toBe(5);
  });

  it("requires admin for a bulk archive but allows marketer to tag", async () => {
    const client = await seedWorkspace("marketer");
    const tag = await client.contactResources.createTag({ name: "Bulk", color: "#64748b" });
    const contact = await client.contacts.create({ email: "b@example.com", customFields: {} });

    await expect(
      client.contactResources.bulkAction({ contactIds: [contact.id], action: "archive" }),
    ).rejects.toMatchObject({ code: "ARCHIVE_FORBIDDEN", status: 403 });

    await expect(
      client.contactResources.bulkAction({ contactIds: [contact.id], action: "add_tag" }),
    ).rejects.toMatchObject({ code: "RESOURCE_REQUIRED", status: 422 });

    await expect(
      client.contactResources.bulkAction({
        contactIds: [contact.id],
        action: "add_tag",
        resourceId: tag.id,
      }),
    ).resolves.toEqual({ updated: 1 });
  });

  it("rejects a duplicate tag name", async () => {
    const client = await seedWorkspace();
    await client.contactResources.createTag({ name: "Dup", color: "#64748b" });
    await expect(
      client.contactResources.createTag({ name: "Dup", color: "#64748b" }),
    ).rejects.toMatchObject({ code: "TAG_CONFLICT", status: 409 });
  });
});

import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  AccountRepository,
  ContactRepository,
  auditLogs,
  campaignEnrollments,
  campaignJobs,
  campaigns,
  campaignVersions,
  claimDueJobs,
  companyContacts,
  contactListMemberships,
  contactLists,
  contactTags,
  contacts,
  createDatabase,
  member,
  organization,
  reserveIdempotencyKey,
  resolveMemberContext,
  segmentMemberships,
  segments,
  tags,
  user,
  uuidv7,
  writeAuditLog,
} from "@kaenma/database";
import type { WorkspaceContext, WorkspaceRole } from "@kaenma/shared";

const database = () => createDatabase(env.DB);

describe("contact and account repositories", () => {
  it("keeps reads and writes scoped to the current workspace", async () => {
    const first = await seedWorkspace("first");
    const second = await seedWorkspace("second");
    const firstRepository = new ContactRepository(env.DB, first);
    const secondRepository = new ContactRepository(env.DB, second);

    const visible = await firstRepository.createContact({
      email: "VISIBLE@EXAMPLE.COM",
      firstName: "Visible",
      customFields: { plan: "pro" },
    });
    const hidden = await secondRepository.createContact({
      email: "hidden@example.com",
      firstName: "Hidden",
      customFields: {},
    });

    await expect(firstRepository.listContacts({})).resolves.toMatchObject({
      items: [{ id: visible.id, email: "visible@example.com", customFields: { plan: "pro" } }],
      total: 1,
    });
    await expect(firstRepository.getContact(hidden.id)).resolves.toBeNull();
    await expect(
      firstRepository.updateContact(hidden.id, { firstName: "Leaked" }),
    ).resolves.toBeNull();
    await expect(firstRepository.archiveContact(hidden.id)).resolves.toBe(false);
  });

  it("paginates deterministically and treats LIKE wildcards as literals", async () => {
    const context = await seedWorkspace("paging");
    const repository = new ContactRepository(env.DB, context);
    const alpha = await repository.createContact({
      email: "alpha@example.com",
      firstName: "100% Genuine",
      customFields: {},
    });
    const beta = await repository.createContact({
      email: "beta@example.com",
      firstName: "Beta",
      customFields: {},
    });
    const gamma = await repository.createContact({
      email: "gamma@example.com",
      firstName: "Gamma",
      customFields: {},
    });

    const firstPage = await repository.listContacts({
      status: "all",
      sort: "email",
      direction: "asc",
      limit: 2,
    });
    expect(firstPage.items.map((contact) => contact.id)).toEqual([alpha.id, beta.id]);
    expect(firstPage).toMatchObject({ total: 3, nextCursor: beta.id });

    const secondPage = await repository.listContacts({
      status: "all",
      sort: "email",
      direction: "asc",
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items.map((contact) => contact.id)).toEqual([gamma.id]);
    expect(secondPage.nextCursor).toBeUndefined();

    const literalWildcard = await repository.listContacts({ status: "all", query: "%" });
    expect(literalWildcard.items.map((contact) => contact.id)).toEqual([alpha.id]);
  });

  it("filters through relationships and excludes archived contacts from account totals", async () => {
    const context = await seedWorkspace("relations");
    const contactRepository = new ContactRepository(env.DB, context);
    const accountRepository = new AccountRepository(env.DB, context);
    const contact = await contactRepository.createContact({
      email: "related@example.com",
      stage: "customer",
      customFields: {},
    });
    const account = await accountRepository.createAccount({ name: "Related Company" });
    const now = new Date().toISOString();
    const tagId = uuidv7();
    const listId = uuidv7();
    const segmentId = uuidv7();

    await database().orm.batch([
      database().orm.insert(companyContacts).values({
        workspaceId: context.workspaceId,
        companyId: account.id,
        contactId: contact.id,
        createdAt: now,
      }),
      database().orm.insert(tags).values({
        id: tagId,
        workspaceId: context.workspaceId,
        name: "Customer",
        slug: "customer",
        createdAt: now,
      }),
      database().orm.insert(contactTags).values({
        workspaceId: context.workspaceId,
        contactId: contact.id,
        tagId,
        createdAt: now,
      }),
      database().orm.insert(contactLists).values({
        id: listId,
        workspaceId: context.workspaceId,
        name: "Newsletter",
        slug: "newsletter",
        createdAt: now,
        updatedAt: now,
      }),
      database().orm.insert(contactListMemberships).values({
        workspaceId: context.workspaceId,
        listId,
        contactId: contact.id,
        status: "active",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      }),
      database().orm.insert(segments).values({
        id: segmentId,
        workspaceId: context.workspaceId,
        name: "Customers",
        slug: "customers",
        kind: "static",
        createdAt: now,
        updatedAt: now,
      }),
      database().orm.insert(segmentMemberships).values({
        workspaceId: context.workspaceId,
        segmentId,
        contactId: contact.id,
        source: "static",
        joinedAt: now,
      }),
    ]);

    for (const filter of [
      { accountId: account.id },
      { tagId },
      { listId },
      { segmentId },
      { stage: "customer" },
    ]) {
      await expect(contactRepository.listContacts(filter)).resolves.toMatchObject({
        items: [{ id: contact.id }],
        total: 1,
      });
    }
    await expect(accountRepository.listAccounts({})).resolves.toEqual([
      expect.objectContaining({ id: account.id, contactCount: 1 }),
    ]);

    await expect(contactRepository.archiveContact(contact.id)).resolves.toBe(true);
    await expect(contactRepository.archiveContact(contact.id)).resolves.toBe(false);
    await expect(accountRepository.listAccounts({})).resolves.toEqual([
      expect.objectContaining({ id: account.id, contactCount: 0 }),
    ]);
    await expect(contactRepository.restoreContact(contact.id)).resolves.toBe(true);
    await expect(contactRepository.restoreContact(contact.id)).resolves.toBe(false);
  });
});

describe("cross-cutting repositories", () => {
  it("resolves the requested membership without crossing organizations", async () => {
    const first = await seedWorkspace("membership-first", "admin");
    const secondOrganizationId = uuidv7();
    const now = new Date();
    await database()
      .orm.insert(organization)
      .values({
        id: secondOrganizationId,
        name: "Second Membership",
        slug: `second-${secondOrganizationId}`,
        createdAt: now,
        timezone: "UTC",
      });
    await database()
      .orm.insert(member)
      .values({
        id: uuidv7(),
        organizationId: secondOrganizationId,
        userId: first.userId,
        role: "viewer",
        createdAt: new Date(now.getTime() + 1_000),
      });

    await expect(resolveMemberContext(env.DB, first.userId, null)).resolves.toEqual(first);
    await expect(resolveMemberContext(env.DB, first.userId, secondOrganizationId)).resolves.toEqual(
      {
        workspaceId: secondOrganizationId,
        userId: first.userId,
        role: "viewer",
      },
    );
    await expect(resolveMemberContext(env.DB, first.userId, uuidv7())).resolves.toBeNull();
  });

  it("reserves idempotency keys per workspace and scope", async () => {
    const first = await seedWorkspace("idempotency-first");
    const second = await seedWorkspace("idempotency-second");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await expect(
      reserveIdempotencyKey(env.DB, first.workspaceId, "contacts", "same-key", expiresAt),
    ).resolves.toBe(true);
    await expect(
      reserveIdempotencyKey(env.DB, first.workspaceId, "contacts", "same-key", expiresAt),
    ).resolves.toBe(false);
    await expect(
      reserveIdempotencyKey(env.DB, first.workspaceId, "events", "same-key", expiresAt),
    ).resolves.toBe(true);
    await expect(
      reserveIdempotencyKey(env.DB, second.workspaceId, "contacts", "same-key", expiresAt),
    ).resolves.toBe(true);
  });

  it("writes structured audit data for the acting workspace", async () => {
    const context = await seedWorkspace("audit");
    await writeAuditLog(env.DB, context, {
      action: "contact.updated",
      resourceType: "contact",
      resourceId: "contact-id",
      metadata: { fields: ["email"] },
      ipAddress: "203.0.113.10",
    });

    const row = await database().orm.query.auditLogs.findFirst({
      where: and(
        eq(auditLogs.workspaceId, context.workspaceId),
        eq(auditLogs.resourceId, "contact-id"),
      ),
    });
    expect(row).toMatchObject({
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      action: "contact.updated",
      resourceType: "contact",
      resourceId: "contact-id",
      metadata: '{"fields":["email"]}',
      ipAddress: "203.0.113.10",
    });
  });

  it("claims only due, unleased campaign jobs in the requested workspace", async () => {
    const first = await seedWorkspace("jobs-first");
    const second = await seedWorkspace("jobs-second");
    const due = "2026-08-01T00:00:00.000Z";
    const later = "2026-08-01T01:00:00.000Z";
    const firstDue = await seedCampaignJob(first, due);
    await seedCampaignJob(first, later);
    await seedCampaignJob(first, due, "2026-08-01T00:30:00.000Z");
    await seedCampaignJob(second, due);

    const claimed = await claimDueJobs(
      env.DB,
      "2026-08-01T00:15:00.000Z",
      "2026-08-01T00:20:00.000Z",
      10,
      first.workspaceId,
    );
    expect(claimed).toEqual([{ id: firstDue, leaseId: expect.any(String) }]);

    const stored = await database().orm.query.campaignJobs.findFirst({
      where: eq(campaignJobs.id, firstDue),
    });
    expect(stored).toMatchObject({
      status: "leased",
      leaseId: claimed[0]?.leaseId,
      leaseUntil: "2026-08-01T00:20:00.000Z",
    });
  });
});

async function seedWorkspace(
  label: string,
  role: WorkspaceRole = "owner",
): Promise<WorkspaceContext> {
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const now = new Date();
  await database().orm.batch([
    database()
      .orm.insert(user)
      .values({
        id: userId,
        name: `${label} User`,
        email: `${label}-${userId}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }),
    database()
      .orm.insert(organization)
      .values({
        id: workspaceId,
        name: `${label} Workspace`,
        slug: `${label}-${workspaceId}`,
        createdAt: now,
        timezone: "UTC",
      }),
  ]);
  await database().orm.insert(member).values({
    id: uuidv7(),
    organizationId: workspaceId,
    userId,
    role,
    createdAt: now,
  });
  return { workspaceId, userId, role };
}

async function seedCampaignJob(
  context: WorkspaceContext,
  dueAt: string,
  leaseUntil: string | null = null,
): Promise<string> {
  const contactId = uuidv7();
  const campaignId = uuidv7();
  const versionId = uuidv7();
  const enrollmentId = uuidv7();
  const jobId = uuidv7();
  const now = new Date().toISOString();
  await database().orm.insert(contacts).values({
    id: contactId,
    workspaceId: context.workspaceId,
    status: "active",
    customFields: "{}",
    createdAt: now,
    updatedAt: now,
  });
  await database()
    .orm.insert(campaigns)
    .values({
      id: campaignId,
      workspaceId: context.workspaceId,
      name: `Campaign ${campaignId}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  await database().orm.insert(campaignVersions).values({
    id: versionId,
    workspaceId: context.workspaceId,
    campaignId,
    version: 1,
    status: "published",
    timezone: "UTC",
    graph: "{}",
    createdAt: now,
  });
  await database().orm.insert(campaignEnrollments).values({
    id: enrollmentId,
    workspaceId: context.workspaceId,
    campaignId,
    campaignVersionId: versionId,
    contactId,
    status: "active",
    enteredAt: now,
    updatedAt: now,
  });
  await database()
    .orm.insert(campaignJobs)
    .values({
      id: jobId,
      workspaceId: context.workspaceId,
      enrollmentId,
      campaignVersionId: versionId,
      nodeId: "node-1",
      recipientId: contactId,
      idempotencyKey: `job-${jobId}`,
      payload: "{}",
      status: "pending",
      dueAt,
      leaseUntil,
      createdAt: now,
      updatedAt: now,
    });
  return jobId;
}

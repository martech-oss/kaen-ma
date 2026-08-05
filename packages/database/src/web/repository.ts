import type {
  ContentDocument,
  LandingPageWrite,
  SignupFormDefinition,
  SignupFormWrite,
  SiteMessageWrite,
  SiteTrackingWrite,
  WorkspaceContext,
} from "@openengage/orpc";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { organization } from "../auth/schema";
import { createDatabase, type DatabaseSource, type OpenEngageDatabase } from "../client";
import { contactEvents, contacts } from "../contacts/schema";
import { uuidv7 } from "../shared/uuid";
import {
  assets,
  forms,
  formSubmissions,
  landingPages,
  landingPageVersions,
  siteMessages,
  siteTrackingSettings,
} from "./schema";

export interface SignupFormRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  version: number;
  definition: SignupFormDefinition;
  allowedDomains: string[];
  turnstileEnabled: boolean;
  successMessage: string;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LandingPageRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  currentVersionId: string | null;
  version: number | null;
  contentDocument: ContentDocument | null;
  createdAt: string;
  updatedAt: string;
}

export type LandingPageUpdateOutcome =
  | { kind: "not_found" }
  | { kind: "archived" }
  | { kind: "ok"; id: string; versionId: string };

export interface SiteTrackingOverview {
  settings: { enabled: boolean; allowedDomains: string[]; updatedAt: string } | null;
  workspaceSlug: string | null;
  summary: { pageViews: number; uniqueVisitors: number; identifiedContacts: number };
  topPages: Array<{ url: string | null; views: number }>;
  recentEvents: Array<{
    visitorId: string | null;
    contactId: string | null;
    resourceId: string | null;
    properties: Record<string, unknown>;
    occurredAt: string;
  }>;
}

export interface SiteMessageRecord {
  id: string;
  name: string;
  status: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string | null;
  pagePattern: string;
  startsAt: string | null;
  endsAt: string | null;
  impressionCount: number;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicFormRecord {
  id: string;
  workspaceId: string;
  name: string;
  definition: Record<string, unknown>;
  allowedDomains: string[];
  turnstileEnabled: boolean;
  successMessage: string;
}

/**
 * Workspace-scoped store for the website center: signup forms, landing
 * pages (+ versions), site tracking settings/analytics and in-app site
 * messages. Also carries the handful of visitor-identity lookups the public
 * tracking and site-message endpoints need once they've already resolved a
 * workspace id (via {@link loadPublicTrackingWorkspace}), for cohesion with
 * the rest of the web domain.
 *
 * Scoped by workspace id only (not the full {@link WorkspaceContext}), so a
 * full context is assignable wherever this scope is expected.
 */
export class WebRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
  ) {
    this.database = createDatabase(database);
  }

  public async listSignupForms(): Promise<SignupFormRecord[]> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const rows = await orm
      .select({
        id: forms.id,
        name: forms.name,
        slug: forms.slug,
        status: forms.status,
        version: forms.version,
        definition: forms.definition,
        allowedDomains: forms.allowedDomains,
        turnstileEnabled: forms.turnstileEnabled,
        successMessage: forms.successMessage,
        // Correlated subquery embedded as a real builder (not a `${col}`
        // interpolation): see the module doc for why that matters.
        submissionCount: sql<number>`${orm.$count(
          formSubmissions,
          and(
            eq(formSubmissions.workspaceId, forms.workspaceId),
            eq(formSubmissions.formId, forms.id),
          ),
        )}`.mapWith(Number),
        createdAt: forms.createdAt,
        updatedAt: forms.updatedAt,
      })
      .from(forms)
      .where(and(eq(forms.workspaceId, workspaceId), ne(forms.status, "archived")))
      .orderBy(desc(forms.updatedAt))
      .limit(200);
    return rows.map((row) => ({
      ...row,
      definition: parseJsonRecord(row.definition) as SignupFormDefinition,
      allowedDomains: parseJsonArray(row.allowedDomains) as string[],
    }));
  }

  public async createSignupForm(input: SignupFormWrite): Promise<{ id: string }> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(forms).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      status: input.status,
      definition: JSON.stringify(input.definition),
      allowedDomains: JSON.stringify(input.allowedDomains),
      turnstileEnabled: input.turnstileEnabled,
      successMessage: input.successMessage,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateSignupForm(id: string, input: SignupFormWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({
        name: input.name,
        slug: input.slug,
        status: input.status,
        version: sql`${forms.version} + 1`,
        definition: JSON.stringify(input.definition),
        allowedDomains: JSON.stringify(input.allowedDomains),
        turnstileEnabled: input.turnstileEnabled,
        successMessage: input.successMessage,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(forms.workspaceId, this.context.workspaceId),
          eq(forms.id, id),
          ne(forms.status, "archived"),
        ),
      );
    return result.meta.changes === 1;
  }

  public async archiveSignupForm(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(forms)
      .set({ status: "archived", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(forms.workspaceId, this.context.workspaceId),
          eq(forms.id, id),
          ne(forms.status, "archived"),
        ),
      );
    return result.meta.changes === 1;
  }

  public async listLandingPages(): Promise<LandingPageRecord[]> {
    const rows = await this.database.orm
      .select({
        id: landingPages.id,
        name: landingPages.name,
        slug: landingPages.slug,
        status: landingPages.status,
        currentVersionId: landingPages.currentVersionId,
        createdAt: landingPages.createdAt,
        updatedAt: landingPages.updatedAt,
        version: landingPageVersions.version,
        contentDocument: landingPageVersions.contentDocument,
      })
      .from(landingPages)
      .leftJoin(
        landingPageVersions,
        and(
          eq(landingPageVersions.workspaceId, landingPages.workspaceId),
          eq(landingPageVersions.id, landingPages.currentVersionId),
        ),
      )
      .where(
        and(
          eq(landingPages.workspaceId, this.context.workspaceId),
          ne(landingPages.status, "archived"),
        ),
      )
      .orderBy(desc(landingPages.updatedAt));
    return rows.map((row) => ({
      ...row,
      contentDocument: parseNullableJsonRecord(row.contentDocument) as ContentDocument | null,
    }));
  }

  public async createLandingPage(
    input: LandingPageWrite,
  ): Promise<{ id: string; versionId: string }> {
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(landingPages).values({
        id,
        workspaceId,
        name: input.name,
        slug: input.slug,
        status: input.status,
        currentVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(landingPageVersions).values({
        id: versionId,
        workspaceId,
        pageId: id,
        version: 1,
        contentDocument: JSON.stringify(input.content),
        publishedAt: input.status === "published" ? now : null,
        createdAt: now,
      }),
    ]);
    return { id, versionId };
  }

  /** Each edit appends a new version row and repoints the page at it. */
  public async updateLandingPage(
    id: string,
    input: LandingPageWrite,
  ): Promise<LandingPageUpdateOutcome> {
    const workspaceId = this.context.workspaceId;
    const page = await this.database.orm
      .select({ id: landingPages.id, status: landingPages.status })
      .from(landingPages)
      .where(and(eq(landingPages.workspaceId, workspaceId), eq(landingPages.id, id)))
      .get();
    if (!page) return { kind: "not_found" };
    if (page.status === "archived") return { kind: "archived" };
    // A plain (non-correlated) lookup keyed on the id we already resolved
    // above, so there's no outer-query column to interpolate — and none of
    // the SELECT-column-position pitfall this file otherwise avoids.
    const [versionRow] = await this.database.orm
      .select({ maxVersion: sql<number>`coalesce(max(${landingPageVersions.version}), 0)` })
      .from(landingPageVersions)
      .where(
        and(
          eq(landingPageVersions.workspaceId, workspaceId),
          eq(landingPageVersions.pageId, page.id),
        ),
      );
    const nextVersion = (versionRow?.maxVersion ?? 0) + 1;
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(landingPageVersions).values({
        id: versionId,
        workspaceId,
        pageId: page.id,
        version: nextVersion,
        contentDocument: JSON.stringify(input.content),
        publishedAt: input.status === "published" ? now : null,
        createdAt: now,
      }),
      orm
        .update(landingPages)
        .set({
          name: input.name,
          slug: input.slug,
          status: input.status,
          currentVersionId: versionId,
          updatedAt: now,
        })
        .where(and(eq(landingPages.workspaceId, workspaceId), eq(landingPages.id, page.id))),
    ]);
    return { kind: "ok", id: page.id, versionId };
  }

  public async archiveLandingPage(id: string): Promise<boolean> {
    const result = await this.database.orm
      .update(landingPages)
      .set({ status: "archived", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(landingPages.workspaceId, this.context.workspaceId),
          eq(landingPages.id, id),
          ne(landingPages.status, "archived"),
        ),
      );
    return result.meta.changes === 1;
  }

  /** Loads the tracking settings, 30-day summary/top-pages and recent events in one atomic batch. */
  public async getTrackingOverview(): Promise<SiteTrackingOverview> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const recentWindow = sql`${contactEvents.occurredAt} >= datetime('now', '-30 days')`;
    const [settingsRows, summaryRows, topPageRows, recentEventRows, organizationRows] =
      await orm.batch([
        orm
          .select({
            enabled: siteTrackingSettings.enabled,
            allowedDomains: siteTrackingSettings.allowedDomains,
            updatedAt: siteTrackingSettings.updatedAt,
          })
          .from(siteTrackingSettings)
          .where(eq(siteTrackingSettings.workspaceId, workspaceId)),
        orm
          .select({
            pageViews: count(),
            uniqueVisitors: countDistinct(contactEvents.visitorId),
            identifiedContacts: countDistinct(contactEvents.contactId),
          })
          .from(contactEvents)
          .where(
            and(
              eq(contactEvents.workspaceId, workspaceId),
              eq(contactEvents.type, "page_viewed"),
              recentWindow,
            ),
          ),
        orm
          .select({ url: contactEvents.resourceId, views: count() })
          .from(contactEvents)
          .where(
            and(
              eq(contactEvents.workspaceId, workspaceId),
              eq(contactEvents.type, "page_viewed"),
              recentWindow,
              isNotNull(contactEvents.resourceId),
            ),
          )
          .groupBy(contactEvents.resourceId)
          .orderBy(desc(count()))
          .limit(10),
        orm
          .select({
            visitorId: contactEvents.visitorId,
            contactId: contactEvents.contactId,
            resourceId: contactEvents.resourceId,
            properties: contactEvents.properties,
            occurredAt: contactEvents.occurredAt,
          })
          .from(contactEvents)
          .where(
            and(eq(contactEvents.workspaceId, workspaceId), eq(contactEvents.type, "page_viewed")),
          )
          .orderBy(desc(contactEvents.occurredAt))
          .limit(20),
        orm
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, workspaceId)),
      ]);
    const settingsRow = settingsRows[0];
    return {
      settings: settingsRow
        ? {
            enabled: settingsRow.enabled,
            allowedDomains: parseJsonArray(settingsRow.allowedDomains) as string[],
            updatedAt: settingsRow.updatedAt,
          }
        : null,
      workspaceSlug: organizationRows[0]?.slug ?? null,
      summary: {
        pageViews: summaryRows[0]?.pageViews ?? 0,
        uniqueVisitors: summaryRows[0]?.uniqueVisitors ?? 0,
        identifiedContacts: summaryRows[0]?.identifiedContacts ?? 0,
      },
      topPages: topPageRows,
      recentEvents: recentEventRows.map((row) => ({
        ...row,
        properties: parseJsonRecord(row.properties),
      })),
    };
  }

  /** Upserts the singleton tracking-settings row for this workspace. */
  public async saveTrackingSettings(input: SiteTrackingWrite): Promise<void> {
    const now = new Date().toISOString();
    const allowedDomains = JSON.stringify([...new Set(input.allowedDomains)]);
    await this.database.orm
      .insert(siteTrackingSettings)
      .values({
        workspaceId: this.context.workspaceId,
        enabled: input.enabled,
        allowedDomains,
        consentMode: "required",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: siteTrackingSettings.workspaceId,
        set: { enabled: input.enabled, allowedDomains, updatedAt: now },
      });
  }

  public async listSiteMessages(): Promise<SiteMessageRecord[]> {
    return await this.database.orm
      .select({
        id: siteMessages.id,
        name: siteMessages.name,
        status: siteMessages.status,
        headline: siteMessages.headline,
        body: siteMessages.body,
        ctaLabel: siteMessages.ctaLabel,
        ctaUrl: siteMessages.ctaUrl,
        pagePattern: siteMessages.pagePattern,
        startsAt: siteMessages.startsAt,
        endsAt: siteMessages.endsAt,
        impressionCount: siteMessages.impressionCount,
        clickCount: siteMessages.clickCount,
        createdAt: siteMessages.createdAt,
        updatedAt: siteMessages.updatedAt,
      })
      .from(siteMessages)
      .where(
        and(
          eq(siteMessages.workspaceId, this.context.workspaceId),
          ne(siteMessages.status, "archived"),
        ),
      )
      .orderBy(desc(siteMessages.updatedAt));
  }

  public async createSiteMessage(input: SiteMessageWrite): Promise<{ id: string }> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(siteMessages).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      status: input.status,
      headline: input.headline,
      body: input.body,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
      pagePattern: input.pagePattern,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  public async updateSiteMessage(id: string, input: SiteMessageWrite): Promise<boolean> {
    const result = await this.database.orm
      .update(siteMessages)
      .set({
        name: input.name,
        status: input.status,
        headline: input.headline,
        body: input.body,
        ctaLabel: input.ctaLabel,
        ctaUrl: input.ctaUrl,
        pagePattern: input.pagePattern,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(siteMessages.workspaceId, this.context.workspaceId),
          eq(siteMessages.id, id),
          ne(siteMessages.status, "archived"),
        ),
      );
    return result.meta.changes === 1;
  }

  public async archiveSiteMessage(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(siteMessages)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(siteMessages.workspaceId, this.context.workspaceId),
          eq(siteMessages.id, id),
          ne(siteMessages.status, "archived"),
        ),
      );
    return result.meta.changes === 1;
  }

  /** Used by the tracking beacon to attach a page view to a known contact. */
  public async findActiveContactIdByEmail(email: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, this.context.workspaceId),
          eq(contacts.email, email),
          ne(contacts.status, "archived"),
        ),
      )
      .get();
    return row?.id ?? null;
  }

  /** The most recently identified contact behind a tracking visitor id, if any. */
  public async findVisitorContactId(visitorId: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ contactId: contactEvents.contactId })
      .from(contactEvents)
      .where(
        and(
          eq(contactEvents.workspaceId, this.context.workspaceId),
          eq(contactEvents.visitorId, visitorId),
          isNotNull(contactEvents.contactId),
        ),
      )
      .orderBy(desc(contactEvents.occurredAt))
      .limit(1)
      .get();
    return row?.contactId ?? null;
  }

  public async listActiveSiteMessagesForVisitor(now: string): Promise<
    Array<{
      id: string;
      headline: string;
      body: string;
      ctaLabel: string;
      ctaUrl: string | null;
      pagePattern: string;
    }>
  > {
    return await this.database.orm
      .select({
        id: siteMessages.id,
        headline: siteMessages.headline,
        body: siteMessages.body,
        ctaLabel: siteMessages.ctaLabel,
        ctaUrl: siteMessages.ctaUrl,
        pagePattern: siteMessages.pagePattern,
      })
      .from(siteMessages)
      .where(
        and(
          eq(siteMessages.workspaceId, this.context.workspaceId),
          eq(siteMessages.status, "published"),
          or(isNull(siteMessages.startsAt), lte(siteMessages.startsAt, now)),
          or(isNull(siteMessages.endsAt), gte(siteMessages.endsAt, now)),
        ),
      )
      .orderBy(desc(siteMessages.updatedAt))
      .limit(20);
  }

  /** Deliberately leaves `updated_at` untouched, matching the prior `updated_at = updated_at` no-op. */
  public async incrementSiteMessageCounter(
    messageId: string,
    counter: "impression" | "click",
  ): Promise<boolean> {
    const scope = and(
      eq(siteMessages.workspaceId, this.context.workspaceId),
      eq(siteMessages.id, messageId),
      eq(siteMessages.status, "published"),
    );
    const result =
      counter === "impression"
        ? await this.database.orm
            .update(siteMessages)
            .set({ impressionCount: sql`${siteMessages.impressionCount} + 1` })
            .where(scope)
        : await this.database.orm
            .update(siteMessages)
            .set({ clickCount: sql`${siteMessages.clickCount} + 1` })
            .where(scope);
    return result.meta.changes === 1;
  }

  /** Direct timeline write, deliberately bypassing automation enrollment (unlike `recordContactEvent`). */
  public async recordSiteMessageEvent(input: {
    contactId: string;
    visitorId: string;
    messageId: string;
    type: "impression" | "click";
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.database.orm.insert(contactEvents).values({
      id: uuidv7(),
      workspaceId: this.context.workspaceId,
      contactId: input.contactId,
      visitorId: input.visitorId,
      type: input.type === "impression" ? "site_message_viewed" : "site_message_clicked",
      resourceType: "site_message",
      resourceId: input.messageId,
      properties: "{}",
      occurredAt: now,
      createdAt: now,
    });
  }
}

/**
 * Public, unauthenticated lookups and writes behind the hosted signup form
 * and its submission endpoint. Intentionally not workspace-scoped, like
 * {@link MessagingWorkerRepository}: the first call resolves the workspace
 * from the public slug pair, and callers pass the resolved id to every call
 * after that.
 */
export class PublicFormRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(database: DatabaseSource) {
    this.database = createDatabase(database);
  }

  /** Resolves a published form from its public workspace-slug/form-slug pair. */
  public async findPublishedForm(
    workspaceSlug: string,
    formSlug: string,
  ): Promise<PublicFormRecord | null> {
    const row = await this.database.orm
      .select({
        id: forms.id,
        workspaceId: forms.workspaceId,
        name: forms.name,
        definition: forms.definition,
        allowedDomains: forms.allowedDomains,
        turnstileEnabled: forms.turnstileEnabled,
        successMessage: forms.successMessage,
      })
      .from(forms)
      .innerJoin(organization, eq(organization.id, forms.workspaceId))
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(forms.slug, formSlug),
          eq(forms.status, "published"),
        ),
      )
      .get();
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      definition: parseJsonRecord(row.definition),
      allowedDomains: parseJsonArray(row.allowedDomains) as string[],
      turnstileEnabled: row.turnstileEnabled,
      successMessage: row.successMessage,
    };
  }

  public async findContactIdByEmail(workspaceId: string, email: string): Promise<string | null> {
    const row = await this.database.orm
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email)))
      .get();
    return row?.id ?? null;
  }

  public async updateContactFromFormSubmission(
    workspaceId: string,
    contactId: string,
    input: { firstName: string | null; lastName: string | null; phone: string | null },
  ): Promise<void> {
    await this.database.orm
      .update(contacts)
      .set({
        firstName: sql`coalesce(${input.firstName}, ${contacts.firstName})`,
        lastName: sql`coalesce(${input.lastName}, ${contacts.lastName})`,
        phone: sql`coalesce(${input.phone}, ${contacts.phone})`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }

  public async createContactFromFormSubmission(
    workspaceId: string,
    contactId: string,
    email: string,
    input: { firstName: string | null; lastName: string | null; phone: string | null },
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.database.orm.insert(contacts).values({
      id: contactId,
      workspaceId,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      stage: "lead",
      score: 0,
      status: "active",
      customFields: "{}",
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Unique-key violations (duplicate idempotency key) bubble up to the caller. */
  public async insertFormSubmission(input: {
    workspaceId: string;
    formId: string;
    contactId: string | null;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    ipHash: string | null;
  }): Promise<void> {
    await this.database.orm.insert(formSubmissions).values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      formId: input.formId,
      contactId: input.contactId,
      idempotencyKey: input.idempotencyKey,
      payload: JSON.stringify(input.payload),
      ipHash: input.ipHash,
      createdAt: new Date().toISOString(),
    });
  }
}

export interface PublicAssetRecord {
  id: string;
  workspaceId: string;
  name: string;
  originalFilename: string;
  kind: string;
  r2Key: string;
  contentType: string;
  checksum: string;
}

/**
 * The single gate in front of publicly readable assets. It lives here rather
 * than in `apps/server` because the `openengage-assets` bucket also holds contact
 * CSV exports, inbound email attachments and event archives - every one of the
 * three predicates below (workspace slug, public visibility, not archived) is
 * load-bearing, so the query is kept where it can be unit-tested directly.
 */
export class PublicAssetRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(database: DatabaseSource) {
    this.database = createDatabase(database);
  }

  public async findPublicAsset(
    workspaceSlug: string,
    assetId: string,
  ): Promise<PublicAssetRecord | null> {
    const row = await this.database.orm
      .select({
        id: assets.id,
        workspaceId: assets.workspaceId,
        name: assets.name,
        originalFilename: assets.originalFilename,
        kind: assets.kind,
        r2Key: assets.r2Key,
        contentType: assets.contentType,
        checksum: assets.checksum,
      })
      .from(assets)
      .innerJoin(organization, eq(organization.id, assets.workspaceId))
      .where(
        and(
          eq(organization.slug, workspaceSlug),
          eq(assets.id, assetId),
          eq(assets.visibility, "public"),
          isNull(assets.archivedAt),
        ),
      )
      .get();
    return row ?? null;
  }
}

/** Parses a JSON object column, treating malformed or non-object values as `{}`. */
function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Parses a JSON array column, treating malformed or non-array values as `[]`. */
function parseJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Parses a nullable JSON object column; null and malformed values both become null. */
function parseNullableJsonRecord(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

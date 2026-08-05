import type { WorkspaceContext } from "@openengage/orpc";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { createDatabase, type DatabaseSource, type OpenEngageDatabase } from "../client";
import { contacts } from "../contacts/schema";
import { deliveries, emailTemplates } from "../messaging/schema";
import type { CompiledSegmentFilter } from "../segments/repository";
import { segmentMemberships, segments } from "../segments/schema";
import { uuidv7 } from "../shared/uuid";
import { broadcastRecipients, broadcasts } from "./schema";

/** A broadcast joined with its segment and template, plus delivery counters. */
export interface BroadcastCampaignRecord {
  id: string;
  name: string;
  segmentId: string;
  templateId: string;
  topicId: string | null;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  segmentName: string;
  memberCount: number;
  templateName: string;
  subject: string | null;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
}

/** Everything the broadcast queue worker needs to snapshot and send one broadcast. */
export interface BroadcastSendRecord {
  id: string;
  workspaceId: string;
  segmentId: string;
  templateId: string;
  topicId: string | null;
  status: string;
  startedAt: string;
  segmentKind: "static" | "dynamic";
  filterAst: string | null;
  resendTemplateId: string;
  variables: string;
}

/** The contact fields resolved into broadcast template variables. */
export interface BroadcastContactRecord {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  stage: string;
  score: number;
  customFields: string;
}

/** What broadcast fan-out decided for one snapshotted recipient. */
export type BroadcastDeliveryOutcome =
  | { kind: "skip"; contactId: string }
  | {
      kind: "queue";
      contactId: string;
      delivery: {
        id: string;
        recipient: string;
        topicId: string | null;
        templateId: string;
        idempotencyKey: string;
        payload: string;
      };
    };

/**
 * Admin-facing queries for broadcasts.
 *
 * Scoped by workspace id only (not the full {@link WorkspaceContext}), because
 * the broadcast endpoints authorize upstream and resolve just the workspace
 * id. A full context is assignable wherever this scope is expected.
 */
export class BroadcastRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
  ) {
    this.database = createDatabase(database);
  }

  /**
   * A broadcast may only reference a segment of its workspace and a live,
   * published marketing template without sync errors.
   */
  public async hasValidBroadcastResources(segmentId: string, templateId: string): Promise<boolean> {
    const row = await this.database.orm
      .select({ id: segments.id })
      .from(segments)
      .innerJoin(
        emailTemplates,
        and(
          eq(emailTemplates.id, templateId),
          eq(emailTemplates.workspaceId, segments.workspaceId),
        ),
      )
      .where(
        and(
          eq(segments.workspaceId, this.context.workspaceId),
          eq(segments.id, segmentId),
          eq(emailTemplates.purpose, "marketing"),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.remoteStatus, "published"),
          isNull(emailTemplates.syncError),
        ),
      )
      .get();
    return row !== undefined;
  }

  public async listBroadcasts(archived: boolean): Promise<BroadcastCampaignRecord[]> {
    return await this.campaignQuery()
      .where(
        and(
          eq(broadcasts.workspaceId, this.context.workspaceId),
          archived ? isNotNull(broadcasts.archivedAt) : isNull(broadcasts.archivedAt),
        ),
      )
      .orderBy(desc(broadcasts.updatedAt))
      .limit(200);
  }

  public async getBroadcast(id: string): Promise<BroadcastCampaignRecord | null> {
    const row = await this.campaignQuery()
      .where(and(eq(broadcasts.workspaceId, this.context.workspaceId), eq(broadcasts.id, id)))
      .get();
    return row ?? null;
  }

  public async createBroadcast(input: {
    name: string;
    segmentId: string;
    templateId: string;
    topicId: string | null;
    status: "draft" | "scheduled";
    scheduledAt: string | null;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(broadcasts).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      segmentId: input.segmentId,
      templateId: input.templateId,
      topicId: input.topicId,
      status: input.status,
      scheduledAt: input.scheduledAt,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  /** Rewrites a broadcast while it is still editable (draft or scheduled). */
  public async updateBroadcast(
    id: string,
    input: {
      name: string;
      segmentId: string;
      templateId: string;
      topicId: string | null;
      status: "draft" | "scheduled";
      scheduledAt: string | null;
    },
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(broadcasts)
      .set({
        name: input.name,
        segmentId: input.segmentId,
        templateId: input.templateId,
        topicId: input.topicId,
        status: input.status,
        scheduledAt: input.scheduledAt,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(broadcasts.workspaceId, this.context.workspaceId),
          eq(broadcasts.id, id),
          isNull(broadcasts.archivedAt),
          inArray(broadcasts.status, ["draft", "scheduled"]),
        ),
      );
    return result.meta.changes === 1;
  }

  /** Flips an editable broadcast to sending, keeping any earlier start time. */
  public async startBroadcast(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(broadcasts)
      .set({
        status: "sending",
        startedAt: sql`COALESCE(${broadcasts.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(broadcasts.workspaceId, this.context.workspaceId),
          eq(broadcasts.id, id),
          isNull(broadcasts.archivedAt),
          inArray(broadcasts.status, ["draft", "scheduled"]),
        ),
      );
    return result.meta.changes === 1;
  }

  /**
   * Archives a broadcast that is not currently sending; drafts and scheduled
   * broadcasts are cancelled on the way out.
   */
  public async archiveBroadcast(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(broadcasts)
      .set({
        status: sql`CASE WHEN ${broadcasts.status} IN ('draft', 'scheduled') THEN 'cancelled' ELSE ${broadcasts.status} END`,
        archivedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(broadcasts.workspaceId, this.context.workspaceId),
          eq(broadcasts.id, id),
          isNull(broadcasts.archivedAt),
          ne(broadcasts.status, "sending"),
        ),
      );
    return result.meta.changes === 1;
  }

  private campaignQuery() {
    return this.database.orm
      .select({
        id: broadcasts.id,
        name: broadcasts.name,
        segmentId: broadcasts.segmentId,
        templateId: broadcasts.templateId,
        topicId: broadcasts.topicId,
        status: broadcasts.status,
        scheduledAt: broadcasts.scheduledAt,
        startedAt: broadcasts.startedAt,
        completedAt: broadcasts.completedAt,
        archivedAt: broadcasts.archivedAt,
        createdAt: broadcasts.createdAt,
        updatedAt: broadcasts.updatedAt,
        segmentName: segments.name,
        memberCount: segments.memberCount,
        templateName: emailTemplates.name,
        subject: emailTemplates.subject,
        recipientCount: sql<number>`(SELECT COUNT(*) FROM ${broadcastRecipients}
          WHERE ${broadcastRecipients.workspaceId} = ${broadcasts.workspaceId}
            AND ${broadcastRecipients.broadcastId} = ${broadcasts.id})`
          .mapWith(Number)
          .as("recipient_count"),
        sentCount: sql<number>`(SELECT COUNT(*) FROM ${deliveries}
          WHERE ${deliveries.workspaceId} = ${broadcasts.workspaceId}
            AND ${deliveries.broadcastId} = ${broadcasts.id}
            AND ${deliveries.status} IN ('accepted', 'delivered'))`
          .mapWith(Number)
          .as("sent_count"),
        deliveredCount: sql<number>`(SELECT COUNT(*) FROM ${deliveries}
          WHERE ${deliveries.workspaceId} = ${broadcasts.workspaceId}
            AND ${deliveries.broadcastId} = ${broadcasts.id}
            AND ${deliveries.status} = 'delivered')`
          .mapWith(Number)
          .as("delivered_count"),
      })
      .from(broadcasts)
      .innerJoin(
        segments,
        and(
          eq(segments.workspaceId, broadcasts.workspaceId),
          eq(segments.id, broadcasts.segmentId),
        ),
      )
      .innerJoin(
        emailTemplates,
        and(
          eq(emailTemplates.workspaceId, broadcasts.workspaceId),
          eq(emailTemplates.id, broadcasts.templateId),
        ),
      );
  }
}

/**
 * Queue-worker queries for broadcast fan-out. Broadcasts are claimed by id
 * alone — the workspace comes from the broadcast row itself — so this
 * repository is intentionally not workspace-scoped.
 */
export class BroadcastWorkerRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(database: DatabaseSource) {
    this.database = createDatabase(database);
  }

  /** Loads a sending broadcast whose template is still valid for marketing. */
  public async findSendingBroadcast(broadcastId: string): Promise<BroadcastSendRecord | null> {
    const row = await this.database.orm
      .select({
        id: broadcasts.id,
        workspaceId: broadcasts.workspaceId,
        segmentId: broadcasts.segmentId,
        templateId: broadcasts.templateId,
        topicId: broadcasts.topicId,
        status: broadcasts.status,
        startedAt: broadcasts.startedAt,
        segmentKind: segments.kind,
        filterAst: segments.filterAst,
        resendTemplateId: emailTemplates.resendTemplateId,
        variables: emailTemplates.variables,
      })
      .from(broadcasts)
      .innerJoin(
        segments,
        and(
          eq(segments.id, broadcasts.segmentId),
          eq(segments.workspaceId, broadcasts.workspaceId),
        ),
      )
      .innerJoin(
        emailTemplates,
        and(
          eq(emailTemplates.id, broadcasts.templateId),
          eq(emailTemplates.workspaceId, broadcasts.workspaceId),
        ),
      )
      .where(
        and(
          eq(broadcasts.id, broadcastId),
          eq(broadcasts.status, "sending"),
          eq(emailTemplates.purpose, "marketing"),
          eq(emailTemplates.remoteStatus, "published"),
          isNull(emailTemplates.syncError),
          isNull(emailTemplates.archivedAt),
        ),
      )
      .get();
    if (!row) return null;
    return {
      ...row,
      // Both start paths coalesce started_at, so a sending broadcast has one;
      // the check constraint restricts segment kinds to this union.
      startedAt: row.startedAt as string,
      segmentKind: row.segmentKind as "static" | "dynamic",
    };
  }

  /** Pages the active members a static segment had when the broadcast started. */
  public async listStaticSegmentContacts(
    workspaceId: string,
    segmentId: string,
    snapshotAt: string,
    afterContactId: string,
    limit: number,
  ): Promise<BroadcastContactRecord[]> {
    return await this.database.orm
      .select(broadcastContactSelection())
      .from(segmentMemberships)
      .innerJoin(
        contacts,
        and(
          eq(contacts.id, segmentMemberships.contactId),
          eq(contacts.workspaceId, segmentMemberships.workspaceId),
        ),
      )
      .where(
        and(
          eq(segmentMemberships.workspaceId, workspaceId),
          eq(segmentMemberships.segmentId, segmentId),
          lte(segmentMemberships.joinedAt, snapshotAt),
          gt(contacts.id, afterContactId),
          eq(contacts.status, "active"),
        ),
      )
      .orderBy(asc(contacts.id))
      .limit(limit);
  }

  /**
   * Pages the active contacts matched by a compiled dynamic segment filter,
   * frozen at the broadcast start time via `updated_at`. The filter aliases
   * contacts as `c`, so the appended conditions are builder-hostile and stay
   * a SQL template.
   */
  public async listDynamicSegmentContacts(
    compiled: CompiledSegmentFilter,
    snapshotAt: string,
    afterContactId: string,
    limit: number,
  ): Promise<BroadcastContactRecord[]> {
    const rows = await this.database.orm.all<{
      id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      stage: string;
      score: number;
      custom_fields: string;
    }>(
      sql`${compiledFilterSql(compiled)} AND c.updated_at <= ${snapshotAt}
          AND c.id > ${afterContactId} AND c.status = 'active'
          ORDER BY c.id ASC LIMIT ${limit}`,
    );
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      stage: row.stage,
      score: row.score,
      customFields: row.custom_fields,
    }));
  }

  /** Snapshots one page of recipients, skipping already-snapshotted contacts. */
  public async insertBroadcastRecipients(
    workspaceId: string,
    broadcastId: string,
    contactIds: string[],
    snapshotAt: string,
  ): Promise<void> {
    const orm = this.database.orm;
    const [first, ...rest] = contactIds.map((contactId) =>
      orm
        .insert(broadcastRecipients)
        .values({ workspaceId, broadcastId, contactId, snapshotAt })
        .onConflictDoNothing(),
    );
    if (first) await orm.batch([first, ...rest]);
  }

  /** Pages snapshotted recipients not yet through the fan-out decision, by contact id. */
  public async listPendingBroadcastRecipients(
    workspaceId: string,
    broadcastId: string,
    afterContactId: string,
    limit: number,
  ): Promise<BroadcastContactRecord[]> {
    return await this.database.orm
      .select(broadcastContactSelection())
      .from(broadcastRecipients)
      .innerJoin(
        contacts,
        and(
          eq(contacts.id, broadcastRecipients.contactId),
          eq(contacts.workspaceId, broadcastRecipients.workspaceId),
        ),
      )
      .where(
        and(
          eq(broadcastRecipients.workspaceId, workspaceId),
          eq(broadcastRecipients.broadcastId, broadcastId),
          isNull(broadcastRecipients.processedAt),
          gt(contacts.id, afterContactId),
        ),
      )
      .orderBy(asc(contacts.id))
      .limit(limit);
  }

  /**
   * Applies one page of fan-out outcomes atomically (one D1 batch): contacts
   * without an email are marked processed with no delivery, everyone else
   * gets a queued delivery - deduplicated on the idempotency key - and their
   * recipient row marked processed. Delivery outcome (sent, bounced,
   * opened, ...) is tracked entirely on `deliveries` from here on.
   */
  public async applyBroadcastDeliveryOutcomes(
    workspaceId: string,
    broadcastId: string,
    outcomes: BroadcastDeliveryOutcome[],
  ): Promise<void> {
    const now = new Date().toISOString();
    const orm = this.database.orm;
    const statements: BatchItem<"sqlite">[] = [];
    for (const outcome of outcomes) {
      const recipientScope = and(
        eq(broadcastRecipients.workspaceId, workspaceId),
        eq(broadcastRecipients.broadcastId, broadcastId),
        eq(broadcastRecipients.contactId, outcome.contactId),
        isNull(broadcastRecipients.processedAt),
      );
      if (outcome.kind === "skip") {
        statements.push(
          orm.update(broadcastRecipients).set({ processedAt: now }).where(recipientScope),
        );
        continue;
      }
      statements.push(
        orm
          .insert(deliveries)
          .values({
            id: outcome.delivery.id,
            workspaceId,
            contactId: outcome.contactId,
            broadcastId,
            channel: "email",
            purpose: "marketing",
            provider: "resend",
            recipient: outcome.delivery.recipient,
            topicId: outcome.delivery.topicId,
            templateId: outcome.delivery.templateId,
            idempotencyKey: outcome.delivery.idempotencyKey,
            payload: outcome.delivery.payload,
            status: "queued",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing(),
        orm.update(broadcastRecipients).set({ processedAt: now }).where(recipientScope),
      );
    }
    const [first, ...rest] = statements;
    if (first) await orm.batch([first, ...rest]);
  }

  /** Completes a broadcast once the last fan-out page has been processed. */
  public async completeSendingBroadcast(broadcastId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.orm
      .update(broadcasts)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "sending")));
  }

  /** Scheduled broadcasts whose start time has passed, oldest first. */
  public async listDueScheduledBroadcasts(now: string): Promise<Array<{ id: string }>> {
    return await this.database.orm
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, now)))
      .orderBy(asc(broadcasts.scheduledAt))
      .limit(20);
  }

  /**
   * Promotes one due scheduled broadcast to sending, keeping any earlier start
   * time. Returns whether this call won the transition.
   */
  public async promoteScheduledBroadcast(broadcastId: string, now: string): Promise<boolean> {
    const result = await this.database.orm
      .update(broadcasts)
      .set({
        status: "sending",
        startedAt: sql`COALESCE(${broadcasts.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "scheduled")));
    return result.meta.changes === 1;
  }
}

function broadcastContactSelection() {
  return {
    id: contacts.id,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    phone: contacts.phone,
    stage: contacts.stage,
    score: contacts.score,
    customFields: contacts.customFields,
  };
}

/**
 * Interleaves the compiled filter's `?` placeholders with its bound
 * parameters. The SQL text comes from `compileSegmentFilter`, which only emits
 * allowlisted identifiers (never user text), so `sql.raw` is safe for these
 * chunks — and only for these chunks.
 */
function compiledFilterSql(compiled: CompiledSegmentFilter): SQL {
  const parts = compiled.sql.split("?");
  if (parts.length !== compiled.params.length + 1) {
    throw new Error(
      `Compiled segment filter placeholder mismatch: expected ${parts.length - 1}, received ${compiled.params.length}`,
    );
  }
  const chunks: SQL[] = [];
  for (const [index, part] of parts.entries()) {
    if (part) chunks.push(sql.raw(part));
    if (index < compiled.params.length) chunks.push(sql`${compiled.params[index]}`);
  }
  return sql.join(chunks, sql.raw(""));
}

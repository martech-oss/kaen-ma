import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { WorkspaceContext } from "@kaenma/orpc";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { suppressions } from "../consent/schema";
import { contactEvents } from "../contacts/schema";
import { uuidv7 } from "../shared/uuid";
import { webhookEndpoints } from "../workspaces/schema";
import {
  deliveries,
  deliveryEvents,
  emailTemplates,
  inboundEmails,
  messageVariables,
} from "./schema";

export interface EmailTemplateRecord {
  id: string;
  name: string;
  purpose: string;
  resendTemplateId: string;
  resendAlias: string | null;
  subject: string | null;
  remoteStatus: string;
  remoteCurrentVersionId: string;
  hasUnpublishedVersions: boolean;
  variables: string;
  publishedAt: string | null;
  lastSyncedAt: string;
  syncError: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageVariableRecord {
  id: string;
  key: string;
  name: string;
  value: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The delivery columns the queue worker needs to claim and send one delivery. */
export interface DeliveryClaimRecord {
  id: string;
  workspaceId: string;
  contactId: string | null;
  channel: "email" | "webhook";
  purpose: "transactional" | "marketing";
  provider: "resend" | "webhook";
  recipient: string | null;
  topicId: string | null;
  idempotencyKey: string;
  payload: string;
  status: string;
  attempts: number;
}

const emailTemplateSelection = {
  id: emailTemplates.id,
  name: emailTemplates.name,
  purpose: emailTemplates.purpose,
  resendTemplateId: emailTemplates.resendTemplateId,
  resendAlias: emailTemplates.resendAlias,
  subject: emailTemplates.subject,
  remoteStatus: emailTemplates.remoteStatus,
  remoteCurrentVersionId: emailTemplates.remoteCurrentVersionId,
  hasUnpublishedVersions: emailTemplates.hasUnpublishedVersions,
  variables: emailTemplates.variables,
  publishedAt: emailTemplates.publishedAt,
  lastSyncedAt: emailTemplates.lastSyncedAt,
  syncError: emailTemplates.syncError,
  archivedAt: emailTemplates.archivedAt,
  createdAt: emailTemplates.createdAt,
  updatedAt: emailTemplates.updatedAt,
};

/**
 * Admin-facing queries for email templates and message variables.
 *
 * Scoped by workspace id only (not the full {@link WorkspaceContext}), because
 * the messaging endpoints authorize upstream and resolve just the workspace id.
 * A full context is assignable wherever this scope is expected.
 */
export class MessagingRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
  ) {
    this.database = createDatabase(database);
  }

  public async listEmailTemplates(archived: boolean): Promise<EmailTemplateRecord[]> {
    return await this.database.orm
      .select(emailTemplateSelection)
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, this.context.workspaceId),
          archived ? isNotNull(emailTemplates.archivedAt) : isNull(emailTemplates.archivedAt),
        ),
      )
      .orderBy(desc(emailTemplates.updatedAt))
      .limit(200);
  }

  public async getEmailTemplate(id: string): Promise<EmailTemplateRecord | null> {
    const row = await this.database.orm
      .select(emailTemplateSelection)
      .from(emailTemplates)
      .where(
        and(eq(emailTemplates.workspaceId, this.context.workspaceId), eq(emailTemplates.id, id)),
      )
      .get();
    return row ?? null;
  }

  /**
   * Intentionally not workspace-scoped: `resend_template_id` is globally
   * unique, and the import flow rejects a template already registered by any
   * workspace.
   */
  public async findEmailTemplateByResendId(
    resendTemplateId: string,
  ): Promise<{ id: string } | null> {
    const row = await this.database.orm
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(eq(emailTemplates.resendTemplateId, resendTemplateId))
      .get();
    return row ?? null;
  }

  /** Registers an imported Resend template; `variables` is serialized JSON. */
  public async createEmailTemplate(input: {
    name: string;
    purpose: "marketing" | "transactional";
    resendTemplateId: string;
    resendAlias: string | null;
    subject: string | null;
    remoteStatus: "draft" | "published";
    remoteCurrentVersionId: string;
    hasUnpublishedVersions: boolean;
    variables: string;
    publishedAt: string | null;
    syncError: string | null;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(emailTemplates).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      purpose: input.purpose,
      resendTemplateId: input.resendTemplateId,
      resendAlias: input.resendAlias,
      subject: input.subject,
      remoteStatus: input.remoteStatus,
      remoteCurrentVersionId: input.remoteCurrentVersionId,
      hasUnpublishedVersions: input.hasUnpublishedVersions,
      variables: input.variables,
      publishedAt: input.publishedAt,
      lastSyncedAt: now,
      syncError: input.syncError,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  /** Overwrites the mirrored remote state after a successful Resend sync. */
  public async updateEmailTemplateFromRemote(
    id: string,
    input: {
      name: string;
      resendAlias: string | null;
      subject: string | null;
      remoteStatus: "draft" | "published";
      remoteCurrentVersionId: string;
      hasUnpublishedVersions: boolean;
      variables: string;
      publishedAt: string | null;
      syncError: string | null;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.database.orm
      .update(emailTemplates)
      .set({
        name: input.name,
        resendAlias: input.resendAlias,
        subject: input.subject,
        remoteStatus: input.remoteStatus,
        remoteCurrentVersionId: input.remoteCurrentVersionId,
        hasUnpublishedVersions: input.hasUnpublishedVersions,
        variables: input.variables,
        publishedAt: input.publishedAt,
        lastSyncedAt: now,
        syncError: input.syncError,
        updatedAt: now,
      })
      .where(
        and(eq(emailTemplates.workspaceId, this.context.workspaceId), eq(emailTemplates.id, id)),
      );
  }

  public async archiveEmailTemplate(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(emailTemplates)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(emailTemplates.workspaceId, this.context.workspaceId),
          eq(emailTemplates.id, id),
          isNull(emailTemplates.archivedAt),
        ),
      );
    return result.meta.changes === 1;
  }

  public async listMessageVariables(archived: boolean): Promise<MessageVariableRecord[]> {
    return await this.database.orm
      .select({
        id: messageVariables.id,
        key: messageVariables.key,
        name: messageVariables.name,
        value: messageVariables.value,
        description: messageVariables.description,
        archivedAt: messageVariables.archivedAt,
        createdAt: messageVariables.createdAt,
        updatedAt: messageVariables.updatedAt,
      })
      .from(messageVariables)
      .where(
        and(
          eq(messageVariables.workspaceId, this.context.workspaceId),
          archived ? isNotNull(messageVariables.archivedAt) : isNull(messageVariables.archivedAt),
        ),
      )
      .orderBy(desc(messageVariables.updatedAt));
  }

  /** Inserts a variable; unique-key violations bubble up to the caller. */
  public async createMessageVariable(input: {
    key: string;
    name: string;
    value: string;
    description: string;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = new Date().toISOString();
    await this.database.orm.insert(messageVariables).values({
      id,
      workspaceId: this.context.workspaceId,
      key: input.key,
      name: input.name,
      value: input.value,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  /** Updates a live variable; unique-key violations bubble up to the caller. */
  public async updateMessageVariable(
    id: string,
    input: { key: string; name: string; value: string; description: string },
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(messageVariables)
      .set({
        key: input.key,
        name: input.name,
        value: input.value,
        description: input.description,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(messageVariables.workspaceId, this.context.workspaceId),
          eq(messageVariables.id, id),
          isNull(messageVariables.archivedAt),
        ),
      );
    return result.meta.changes === 1;
  }

  public async archiveMessageVariable(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .update(messageVariables)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(messageVariables.workspaceId, this.context.workspaceId),
          eq(messageVariables.id, id),
          isNull(messageVariables.archivedAt),
        ),
      );
    return result.meta.changes === 1;
  }
}

/**
 * Queue-worker and webhook-handler queries for the delivery pipeline.
 * Deliveries are claimed by id alone — the workspace comes from the delivery
 * row itself — so this repository is intentionally not workspace-scoped.
 */
export class MessagingWorkerRepository {
  private readonly database: KaenmaDatabase;

  public constructor(database: DatabaseSource) {
    this.database = createDatabase(database);
  }

  /** Loads a live template for sending; archived templates are invisible. */
  public async findSendableTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<{
    id: string;
    purpose: "marketing" | "transactional";
    resendTemplateId: string;
    remoteStatus: "draft" | "published";
    variables: string;
    syncError: string | null;
  } | null> {
    const row = await this.database.orm
      .select({
        id: emailTemplates.id,
        purpose: emailTemplates.purpose,
        resendTemplateId: emailTemplates.resendTemplateId,
        remoteStatus: emailTemplates.remoteStatus,
        variables: emailTemplates.variables,
        syncError: emailTemplates.syncError,
      })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.id, templateId),
          isNull(emailTemplates.archivedAt),
        ),
      )
      .get();
    if (!row) return null;
    // Check constraints restrict both columns to these unions.
    return {
      ...row,
      purpose: row.purpose as "marketing" | "transactional",
      remoteStatus: row.remoteStatus as "draft" | "published",
    };
  }

  /** Live message variables as a key → value map, for template resolution. */
  public async readMessageVariables(workspaceId: string): Promise<Record<string, string>> {
    const rows = await this.database.orm
      .select({ key: messageVariables.key, value: messageVariables.value })
      .from(messageVariables)
      .where(
        and(eq(messageVariables.workspaceId, workspaceId), isNull(messageVariables.archivedAt)),
      )
      .orderBy(asc(messageVariables.key));
    return Object.fromEntries(rows.map((variable) => [variable.key, variable.value]));
  }

  public async findEnabledWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string } | null> {
    const row = await this.database.orm
      .select({ url: webhookEndpoints.url })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .get();
    return row ?? null;
  }

  public async findEnabledWebhookEndpointWithSecret(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string; encryptedSecret: string } | null> {
    const row = await this.database.orm
      .select({ url: webhookEndpoints.url, encryptedSecret: webhookEndpoints.encryptedSecret })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Enqueues one delivery, skipping the insert when the idempotency key was
   * already used. Returns whether a row was actually written.
   */
  public async insertQueuedDelivery(input: {
    id: string;
    workspaceId: string;
    contactId: string | null;
    enrollmentId: string | null;
    channel: "email" | "webhook";
    purpose: "marketing" | "transactional";
    provider: "resend" | "webhook";
    recipient: string;
    topicId?: string | null;
    templateId?: string | null;
    idempotencyKey: string;
    payload: string;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.database.orm
      .insert(deliveries)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        enrollmentId: input.enrollmentId,
        channel: input.channel,
        purpose: input.purpose,
        provider: input.provider,
        recipient: input.recipient,
        topicId: input.topicId ?? null,
        templateId: input.templateId ?? null,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return result.meta.changes === 1;
  }

  public async findDeliveryForProcessing(deliveryId: string): Promise<DeliveryClaimRecord | null> {
    const row = await this.database.orm
      .select({
        id: deliveries.id,
        workspaceId: deliveries.workspaceId,
        contactId: deliveries.contactId,
        channel: deliveries.channel,
        purpose: deliveries.purpose,
        provider: deliveries.provider,
        recipient: deliveries.recipient,
        topicId: deliveries.topicId,
        idempotencyKey: deliveries.idempotencyKey,
        payload: deliveries.payload,
        status: deliveries.status,
        attempts: deliveries.attempts,
      })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .get();
    if (!row) return null;
    // Check constraints restrict channel, purpose and provider to these unions.
    return {
      ...row,
      channel: row.channel as "email" | "webhook",
      purpose: row.purpose as "transactional" | "marketing",
      provider: row.provider as "resend" | "webhook",
    };
  }

  /** Claims a queued or previously failed delivery, counting the attempt. */
  public async claimDelivery(deliveryId: string): Promise<boolean> {
    const result = await this.database.orm
      .update(deliveries)
      .set({
        status: "sending",
        attempts: sql`${deliveries.attempts} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(deliveries.id, deliveryId), inArray(deliveries.status, ["queued", "failed"])));
    return result.meta.changes === 1;
  }

  public async markDeliverySuppressed(deliveryId: string, reason: string): Promise<void> {
    await this.database.orm
      .update(deliveries)
      .set({ status: "suppressed", lastError: reason, updatedAt: new Date().toISOString() })
      .where(eq(deliveries.id, deliveryId));
  }

  /**
   * Atomically (one D1 batch) marks a sending delivery accepted and records
   * the synthetic `accepted` event, deduplicated per provider event id.
   */
  public async markDeliveryAccepted(input: {
    deliveryId: string;
    workspaceId: string;
    provider: string;
    providerMessageId: string;
    acceptedAt: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(deliveries)
        .set({
          status: "accepted",
          providerMessageId: input.providerMessageId,
          lastError: null,
          updatedAt: now,
        })
        .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.status, "sending"))),
      orm
        .insert(deliveryEvents)
        .values({
          id: uuidv7(),
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          provider: input.provider,
          providerEventId: `accepted:${input.deliveryId}`,
          providerMessageId: input.providerMessageId,
          type: "accepted",
          occurredAt: input.acceptedAt,
          metadata: "{}",
          createdAt: now,
        })
        .onConflictDoNothing(),
    ]);
  }

  /** Records a send failure while the delivery is still claimed as sending. */
  public async recordDeliveryAttemptFailure(
    deliveryId: string,
    input: { status: "queued" | "failed"; nextAttemptAt: string | null; lastError: string },
  ): Promise<void> {
    await this.database.orm
      .update(deliveries)
      .set({
        status: input.status,
        nextAttemptAt: input.nextAttemptAt,
        lastError: input.lastError,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, "sending")));
  }

  /** Queued deliveries whose retry timer (if any) has elapsed, oldest first. */
  public async scanDueDeliveries(now: string): Promise<Array<{ id: string }>> {
    return await this.database.orm
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.status, "queued"),
          or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, now)),
        ),
      )
      .orderBy(asc(deliveries.createdAt))
      .limit(100);
  }

  /** Resolves the delivery a signed reply address points at, if it still exists. */
  public async findReplyDelivery(
    workspaceId: string,
    deliveryId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    const row = await this.database.orm
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.workspaceId, workspaceId),
          eq(deliveries.id, deliveryId),
          eq(deliveries.contactId, contactId),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Atomically (one D1 batch) stores an inbound reply: the raw email, the
   * deduplicated `replied` delivery event, and the contact timeline event.
   */
  public async recordInboundReply(input: {
    workspaceId: string;
    contactId: string;
    deliveryId: string;
    inbound: {
      id: string;
      messageId: string | null;
      sender: string;
      recipient: string;
      subject: string | null;
      textBody: string | null;
      htmlBody: string | null;
      attachmentManifest: string;
    };
    deliveryEventId: string;
    providerEventId: string;
    deliveryEventMetadata: string;
    contactEventId: string;
    contactEventProperties: string;
    receivedAt: string;
  }): Promise<void> {
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(inboundEmails).values({
        id: input.inbound.id,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        deliveryId: input.deliveryId,
        messageId: input.inbound.messageId,
        sender: input.inbound.sender,
        recipient: input.inbound.recipient,
        subject: input.inbound.subject,
        textBody: input.inbound.textBody,
        htmlBody: input.inbound.htmlBody,
        attachmentManifest: input.inbound.attachmentManifest,
        receivedAt: input.receivedAt,
      }),
      orm
        .insert(deliveryEvents)
        .values({
          id: input.deliveryEventId,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          provider: "cloudflare",
          providerEventId: input.providerEventId,
          type: "replied",
          occurredAt: input.receivedAt,
          metadata: input.deliveryEventMetadata,
          createdAt: input.receivedAt,
        })
        .onConflictDoNothing(),
      orm.insert(contactEvents).values({
        id: input.contactEventId,
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        type: "email_replied",
        resourceType: "delivery",
        resourceId: input.deliveryId,
        properties: input.contactEventProperties,
        occurredAt: input.receivedAt,
        createdAt: input.receivedAt,
      }),
    ]);
  }

  /**
   * Applies one normalized Resend webhook event in a single atomic D1 batch:
   * records the event (deduplicated on workspace + provider + event id, and
   * silently dropped when the delivery does not exist), optionally moves the
   * delivery status, and optionally writes the suppression that a bounce,
   * complaint or unsubscribe implies. The suppression insert lives here rather
   * than in the consent repository so it stays in the same atomic batch.
   * Returns whether the event row was actually inserted.
   */
  public async applyResendDeliveryEvent(input: {
    workspaceId: string;
    deliveryId: string;
    providerEventId: string;
    providerMessageId: string | null;
    type: string;
    occurredAt: string;
    metadata: string;
    status: "delivered" | "failed" | null;
    suppressionReason: "bounce" | "complaint" | "global_unsubscribe" | null;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const orm = this.database.orm;
    const deliveryScope = and(
      eq(deliveries.workspaceId, input.workspaceId),
      eq(deliveries.id, input.deliveryId),
    );
    // insert-from-select: drizzle emits the full column list in declaration
    // order, so each SELECT below lists every target column in exactly that
    // order.
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      orm
        .insert(deliveryEvents)
        .select(
          orm
            .select({
              id: sql<string>`${uuidv7()}`.as("id"),
              workspaceId: sql<string>`${input.workspaceId}`.as("workspace_id"),
              deliveryId: deliveries.id,
              provider: sql<string>`'resend'`.as("provider"),
              providerEventId: sql<string>`${input.providerEventId}`.as("provider_event_id"),
              providerMessageId: sql<string | null>`${input.providerMessageId}`.as(
                "provider_message_id",
              ),
              type: sql<string>`${input.type}`.as("type"),
              occurredAt: sql<string>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<string>`${input.metadata}`.as("metadata"),
              archivedAt: sql<string | null>`null`.as("archived_at"),
              createdAt: sql<string>`${now}`.as("created_at"),
            })
            .from(deliveries)
            .where(deliveryScope),
        )
        .onConflictDoNothing(),
    ];
    if (input.status) {
      statements.push(
        orm
          .update(deliveries)
          .set({ status: input.status, updatedAt: new Date().toISOString() })
          .where(deliveryScope),
      );
    }
    if (input.suppressionReason) {
      statements.push(
        orm
          .insert(suppressions)
          .select(
            orm
              .select({
                id: sql<string>`${uuidv7()}`.as("id"),
                workspaceId: deliveries.workspaceId,
                contactId: deliveries.contactId,
                email: deliveries.recipient,
                reason: sql<string>`${input.suppressionReason}`.as("reason"),
                provider: sql<string>`'resend'`.as("provider"),
                createdAt: sql<string>`${input.occurredAt}`.as("created_at"),
              })
              .from(deliveries)
              .where(deliveryScope),
          )
          .onConflictDoNothing(),
      );
    }
    const results = await orm.batch(statements);
    const eventResult = results[0] as D1Result | undefined;
    return eventResult?.meta.changes === 1;
  }

  /** The contact behind a delivery, for timeline events; null when detached. */
  public async findDeliveryContactId(
    workspaceId: string,
    deliveryId: string,
  ): Promise<string | null> {
    const row = await this.database.orm
      .select({ contactId: deliveries.contactId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.workspaceId, workspaceId),
          eq(deliveries.id, deliveryId),
          isNotNull(deliveries.contactId),
        ),
      )
      .get();
    return row?.contactId ?? null;
  }
}

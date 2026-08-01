import { PermanentChannelError, type ChannelMessage } from "@kaenma/channels";
import { compileSegmentFilter } from "@kaenma/core";
import { createDatabase, uuidv7, type DrizzleRawStatement } from "@kaenma/database";
import { type QueueMessage as KaenmaQueueMessage } from "../runtime/queues";

import { type RuntimeEnv } from "../env";
import { readMessageVariables, senderForPurpose } from "../messaging/delivery-worker";
import { buildReplyAddress } from "../messaging/reply-address";
import { parseTemplateVariables, resolveTemplateVariables } from "../messaging/resend";
import { createSignedToken } from "../platform/crypto";
import { parseJsonRecord } from "../platform/values";

export interface BroadcastRow {
  id: string;
  workspace_id: string;
  segment_id: string;
  template_id: string;
  topic_id: string | null;
  status: string;
  started_at: string;
  segment_kind: "static" | "dynamic";
  filter_ast: string | null;
  resend_template_id: string;
  variables: string;
}

export interface BroadcastContactRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  stage: string;
  score: number;
  custom_fields: string;
}

export async function processBroadcastBatch(
  broadcastId: string,
  phase: "snapshot" | "delivery",
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const broadcast = await createDatabase(env.DB)
    .prepare(
      `SELECT b.id, b.workspace_id, b.segment_id, b.template_id,
            b.topic_id, b.status, b.started_at, s.kind AS segment_kind,
            s.filter_ast, et.resend_template_id, et.variables
     FROM broadcasts b
     JOIN segments s ON s.id = b.segment_id AND s.workspace_id = b.workspace_id
     JOIN email_templates et
       ON et.id = b.template_id AND et.workspace_id = b.workspace_id
     WHERE b.id = ? AND b.status = 'sending' AND et.purpose = 'marketing'
       AND et.remote_status = 'published' AND et.sync_error IS NULL
       AND et.archived_at IS NULL`,
    )
    .bind(broadcastId)
    .first<BroadcastRow>();
  if (!broadcast) return;
  if (phase === "snapshot") {
    await snapshotBroadcastRecipients(broadcast, cursor, env);
    return;
  }
  await createBroadcastDeliveries(broadcast, cursor, env);
}

export async function snapshotBroadcastRecipients(
  broadcast: BroadcastRow,
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const batchSize = 100;
  let rows: BroadcastContactRow[];
  if (broadcast.segment_kind === "static") {
    const result = await createDatabase(env.DB)
      .prepare(
        `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.stage,
              c.score, c.custom_fields
       FROM segment_memberships sm
       JOIN contacts c ON c.id = sm.contact_id AND c.workspace_id = sm.workspace_id
       WHERE sm.workspace_id = ? AND sm.segment_id = ?
         AND sm.joined_at <= ? AND c.id > ? AND c.status = 'active'
       ORDER BY c.id ASC LIMIT ?`,
      )
      .bind(
        broadcast.workspace_id,
        broadcast.segment_id,
        broadcast.started_at,
        cursor ?? "",
        batchSize,
      )
      .all<BroadcastContactRow>();
    rows = result.results;
  } else {
    if (!broadcast.filter_ast) {
      throw new PermanentChannelError("Dynamic broadcast segment has no filter");
    }
    const filter = JSON.parse(broadcast.filter_ast) as Parameters<typeof compileSegmentFilter>[1];
    const compiled = compileSegmentFilter(broadcast.workspace_id, filter);
    const result = await createDatabase(env.DB)
      .prepare(
        `${compiled.sql} AND c.updated_at <= ? AND c.id > ? AND c.status = 'active'
       ORDER BY c.id ASC LIMIT ?`,
      )
      .bind(...compiled.params, broadcast.started_at, cursor ?? "", batchSize)
      .all<BroadcastContactRow>();
    rows = result.results;
  }
  if (rows.length > 0) {
    await createDatabase(env.DB).batch(
      rows.map((contact) =>
        createDatabase(env.DB)
          .prepare(
            `INSERT OR IGNORE INTO broadcast_recipients
           (workspace_id, broadcast_id, contact_id, status, snapshot_at)
           VALUES (?, ?, ?, 'pending', ?)`,
          )
          .bind(broadcast.workspace_id, broadcast.id, contact.id, broadcast.started_at),
      ),
    );
  }
  const last = rows.at(-1);
  if (rows.length === batchSize && last) {
    await env.CAMPAIGN_QUEUE.send({
      kind: "broadcast_batch",
      broadcastId: broadcast.id,
      phase: "snapshot",
      cursor: last.id,
    });
  } else {
    await env.CAMPAIGN_QUEUE.send({
      kind: "broadcast_batch",
      broadcastId: broadcast.id,
      phase: "delivery",
    });
  }
}

export async function createBroadcastDeliveries(
  broadcast: BroadcastRow,
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const batchSize = 40;
  const recipients = await createDatabase(env.DB)
    .prepare(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.stage,
            c.score, c.custom_fields
     FROM broadcast_recipients br
     JOIN contacts c ON c.id = br.contact_id AND c.workspace_id = br.workspace_id
     WHERE br.workspace_id = ? AND br.broadcast_id = ? AND br.status = 'pending'
       AND c.id > ?
     ORDER BY c.id ASC LIMIT ?`,
    )
    .bind(broadcast.workspace_id, broadcast.id, cursor ?? "", batchSize)
    .all<BroadcastContactRow>();
  const templateVariables = parseTemplateVariables(broadcast.variables);
  const message = await readMessageVariables(createDatabase(env.DB), broadcast.workspace_id);
  const statements: DrizzleRawStatement[] = [];
  const deliveryMessages: Array<{ body: KaenmaQueueMessage }> = [];
  for (const contact of recipients.results) {
    if (!contact.email) {
      statements.push(
        createDatabase(env.DB)
          .prepare(
            `UPDATE broadcast_recipients SET status = 'skipped'
           WHERE workspace_id = ? AND broadcast_id = ? AND contact_id = ?`,
          )
          .bind(broadcast.workspace_id, broadcast.id, contact.id),
      );
      continue;
    }
    const deliveryId = uuidv7();
    const contactData = {
      email: contact.email,
      first_name: contact.first_name,
      last_name: contact.last_name,
      phone: contact.phone,
      stage: contact.stage,
      score: contact.score,
      ...parseJsonRecord(contact.custom_fields),
    };
    const unsubscribeToken = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
      workspaceId: broadcast.workspace_id,
      resourceId: broadcast.topic_id ?? "global",
      contactId: contact.id,
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      purpose: "unsubscribe",
    });
    const unsubscribeUrl = `${env.APP_URL}/u/${unsubscribeToken}`;
    const variables = resolveTemplateVariables(templateVariables, {
      contact: contactData,
      customFields: parseJsonRecord(contact.custom_fields),
      message,
      unsubscribeUrl,
      preferenceUrl: `${env.APP_URL}/preference/${unsubscribeToken}`,
    });
    const payload: ChannelMessage = {
      kind: "email",
      idempotencyKey: `${broadcast.id}:${contact.id}`,
      workspaceId: broadcast.workspace_id,
      deliveryId,
      purpose: "marketing",
      to: contact.email,
      from: senderForPurpose(env, "marketing"),
      replyTo: await buildReplyAddress(env, broadcast.workspace_id, deliveryId, contact.id),
      template: { id: broadcast.resend_template_id, variables },
      metadata: {
        broadcastId: broadcast.id,
        unsubscribeUrl,
      },
    };
    statements.push(
      createDatabase(env.DB)
        .prepare(
          `INSERT OR IGNORE INTO deliveries
         (id, workspace_id, contact_id, broadcast_id, channel, purpose, provider,
          recipient, topic_id, template_id, idempotency_key, payload,
          status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'email', 'marketing', 'resend', ?, ?, ?, ?, ?,
                 'queued', ?, ?)`,
        )
        .bind(
          deliveryId,
          broadcast.workspace_id,
          contact.id,
          broadcast.id,
          contact.email,
          broadcast.topic_id,
          broadcast.template_id,
          payload.idempotencyKey,
          JSON.stringify(payload),
          new Date().toISOString(),
          new Date().toISOString(),
        ),
      createDatabase(env.DB)
        .prepare(
          `UPDATE broadcast_recipients SET status = 'queued'
         WHERE workspace_id = ? AND broadcast_id = ? AND contact_id = ? AND status = 'pending'`,
        )
        .bind(broadcast.workspace_id, broadcast.id, contact.id),
    );
    deliveryMessages.push({
      body: { kind: "delivery", deliveryId },
    });
  }
  if (statements.length > 0) await createDatabase(env.DB).batch(statements);
  if (deliveryMessages.length > 0) await env.DELIVERY_QUEUE.sendBatch(deliveryMessages);
  const last = recipients.results.at(-1);
  if (recipients.results.length === batchSize && last) {
    await env.CAMPAIGN_QUEUE.send({
      kind: "broadcast_batch",
      broadcastId: broadcast.id,
      phase: "delivery",
      cursor: last.id,
    });
  } else {
    const now = new Date().toISOString();
    await createDatabase(env.DB)
      .prepare(
        `UPDATE broadcasts SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'sending'`,
      )
      .bind(now, now, broadcast.id)
      .run();
  }
}

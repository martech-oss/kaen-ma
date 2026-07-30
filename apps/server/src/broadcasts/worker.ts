import { PermanentChannelError, type ChannelMessage } from "@kaenma/channels";
import { compileSegmentFilter } from "@kaenma/core";
import { createDatabase, uuidv7, type DrizzleRawStatement } from "@kaenma/database";
import { renderContent, renderSubject } from "@kaenma/email-renderer";
import { contentDocumentSchema, type QueueMessage as KaenmaQueueMessage } from "@kaenma/shared";

import { createSignedToken } from "../crypto";
import { readMessageVariables } from "../deliveries/worker";
import { buildReplyAddress } from "../email/address";
import { type RuntimeEnv } from "../env";
import { safeRecord } from "../runtime/helpers";

export interface BroadcastRow {
  id: string;
  workspace_id: string;
  segment_id: string;
  template_version_id: string;
  topic_id: string | null;
  status: string;
  started_at: string;
  segment_kind: "static" | "dynamic";
  filter_ast: string | null;
  subject: string;
  content_document: string;
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
      `SELECT b.id, b.workspace_id, b.segment_id, b.template_version_id,
            b.topic_id, b.status, b.started_at, s.kind AS segment_kind,
            s.filter_ast, ev.subject, ev.content_document
     FROM broadcasts b
     JOIN segments s ON s.id = b.segment_id AND s.workspace_id = b.workspace_id
     JOIN email_template_versions ev
       ON ev.id = b.template_version_id AND ev.workspace_id = b.workspace_id
     JOIN email_templates et
       ON et.id = ev.template_id AND et.workspace_id = ev.workspace_id
     WHERE b.id = ? AND b.status = 'sending' AND et.purpose = 'marketing'`,
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
  const content = contentDocumentSchema.parse(JSON.parse(broadcast.content_document));
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
      ...safeRecord(contact.custom_fields),
    };
    const unsubscribeToken = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
      workspaceId: broadcast.workspace_id,
      resourceId: broadcast.topic_id ?? "global",
      contactId: contact.id,
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      purpose: "unsubscribe",
    });
    const trackingToken = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
      workspaceId: broadcast.workspace_id,
      resourceId: deliveryId,
      contactId: contact.id,
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      purpose: "tracking",
    });
    const rendered = renderContent(content, {
      contact: contactData,
      workspace: {},
      message,
      unsubscribeUrl: `${env.APP_URL}/u/${unsubscribeToken}`,
      preferenceUrl: `${env.APP_URL}/preference/${unsubscribeToken}`,
    });
    const payload: ChannelMessage = {
      idempotencyKey: `${broadcast.id}:${contact.id}`,
      workspaceId: broadcast.workspace_id,
      deliveryId,
      purpose: "marketing",
      to: contact.email,
      from: {
        email: env.TRANSACTIONAL_FROM_EMAIL,
        name: env.TRANSACTIONAL_FROM_NAME,
      },
      replyTo: await buildReplyAddress(env, broadcast.workspace_id, deliveryId, contact.id),
      subject: renderSubject(broadcast.subject, {
        contact: contactData,
        workspace: {},
        message,
      }),
      html: rendered.html.replace(
        "</body>",
        `<img src="${env.APP_URL}/t/${trackingToken}" width="1" height="1" alt="" style="display:none"></body>`,
      ),
      text: rendered.text,
      metadata: {
        broadcastId: broadcast.id,
        unsubscribeUrl: `${env.APP_URL}/u/${unsubscribeToken}`,
      },
    };
    statements.push(
      createDatabase(env.DB)
        .prepare(
          `INSERT OR IGNORE INTO deliveries
         (id, workspace_id, contact_id, broadcast_id, channel, purpose, provider,
          recipient, topic_id, template_version_id, idempotency_key, payload,
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
          broadcast.template_version_id,
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

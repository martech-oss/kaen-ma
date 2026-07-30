import {
  CloudflareEmailAdapter,
  OutboundWebhookAdapter,
  PermanentChannelError,
  ResendEmailAdapter,
  TransientChannelError,
  type ChannelMessage,
} from "@kaenma/channels";
import { evaluateSendEligibility, retryDelaySeconds } from "@kaenma/core";
import { createDatabase, uuidv7, type KaenmaDatabase } from "@kaenma/database";
import { renderContent, renderSubject } from "@kaenma/email-renderer";
import { contentDocumentSchema, type CampaignNode } from "@kaenma/shared";

import { type CampaignJobRow } from "../campaigns/worker";
import { createSignedToken, decryptCredentials } from "../crypto";
import { buildReplyAddress } from "../email/address";
import { type RuntimeEnv } from "../env";
import { safeRecord } from "../runtime/helpers";

export interface DeliveryRow {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  channel: "email" | "webhook";
  purpose: "transactional" | "marketing";
  provider: "cloudflare" | "postmark" | "resend" | "webhook";
  recipient: string;
  topic_id: string | null;
  idempotency_key: string;
  payload: string;
  status: string;
  attempts: number;
}

export async function createEmailDelivery(
  action: Extract<CampaignNode, { type: "action" }>["config"] & {
    action: "send_email";
  },
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<void> {
  if (!job.contact_email) throw new PermanentChannelError("Contact does not have an email");
  const template = await createDatabase(env.DB)
    .prepare(
      `SELECT subject, content_document FROM email_template_versions
     WHERE workspace_id = ? AND id = ?`,
    )
    .bind(job.workspace_id, action.templateVersionId)
    .first<{ subject: string; content_document: string }>();
  if (!template) throw new PermanentChannelError("Email template version is missing");
  const content = contentDocumentSchema.parse(JSON.parse(template.content_document));
  const message = await readMessageVariables(createDatabase(env.DB), job.workspace_id);
  const contact = {
    email: job.contact_email,
    first_name: job.first_name,
    last_name: job.last_name,
    phone: job.phone,
    stage: job.stage,
    score: job.score,
    ...safeRecord(job.custom_fields),
  };
  const unsubscribeToken = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
    workspaceId: job.workspace_id,
    resourceId: action.topicId ?? "global",
    contactId: job.recipient_id,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    purpose: "unsubscribe",
  });
  const deliveryId = uuidv7();
  const trackingToken = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
    workspaceId: job.workspace_id,
    resourceId: deliveryId,
    contactId: job.recipient_id,
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    purpose: "tracking",
  });
  const rendered = renderContent(content, {
    contact,
    workspace: {},
    message,
    unsubscribeUrl: `${env.APP_URL}/u/${unsubscribeToken}`,
    preferenceUrl: `${env.APP_URL}/preference/${unsubscribeToken}`,
  });
  const html = rendered.html.replace(
    "</body>",
    `<img src="${env.APP_URL}/t/${trackingToken}" width="1" height="1" alt="" style="display:none"></body>`,
  );
  const replyTo = await buildReplyAddress(env, job.workspace_id, deliveryId, job.recipient_id);
  const payload: ChannelMessage = {
    idempotencyKey: `${job.idempotency_key}:email`,
    workspaceId: job.workspace_id,
    deliveryId,
    purpose: action.purpose,
    to: job.contact_email,
    from: {
      email: env.TRANSACTIONAL_FROM_EMAIL,
      name: env.TRANSACTIONAL_FROM_NAME,
    },
    replyTo,
    subject: renderSubject(template.subject, {
      contact,
      workspace: {},
      message,
    }),
    html,
    text: rendered.text,
    ...(action.purpose === "marketing"
      ? { metadata: { unsubscribeUrl: `${env.APP_URL}/u/${unsubscribeToken}` } }
      : {}),
  };
  const result = await createDatabase(env.DB)
    .prepare(
      `INSERT OR IGNORE INTO deliveries
     (id, workspace_id, contact_id, enrollment_id, channel, purpose, provider,
      recipient, topic_id, template_version_id, idempotency_key, payload,
      status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    )
    .bind(
      deliveryId,
      job.workspace_id,
      job.recipient_id,
      job.enrollment_id,
      action.purpose,
      action.provider,
      job.contact_email,
      action.topicId ?? null,
      action.templateVersionId,
      payload.idempotencyKey,
      JSON.stringify(payload),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  if (result.meta.changes === 1) {
    await env.DELIVERY_QUEUE.send({ kind: "delivery", deliveryId });
  }
}

export async function createWebhookDelivery(
  endpointId: string,
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<void> {
  const endpoint = await createDatabase(env.DB)
    .prepare(
      `SELECT url FROM webhook_endpoints
     WHERE workspace_id = ? AND id = ? AND enabled = 1`,
    )
    .bind(job.workspace_id, endpointId)
    .first<{ url: string }>();
  if (!endpoint) throw new PermanentChannelError("Webhook endpoint is missing");
  const deliveryId = uuidv7();
  const payload: ChannelMessage = {
    idempotencyKey: `${job.idempotency_key}:webhook`,
    workspaceId: job.workspace_id,
    deliveryId,
    purpose: "transactional",
    to: endpoint.url,
    from: { email: env.TRANSACTIONAL_FROM_EMAIL, name: env.TRANSACTIONAL_FROM_NAME },
    subject: "Kaenma campaign event",
    html: "",
    text: "",
    metadata: {
      contactId: job.recipient_id,
      enrollmentId: job.enrollment_id,
    },
  };
  const result = await createDatabase(env.DB)
    .prepare(
      `INSERT OR IGNORE INTO deliveries
     (id, workspace_id, contact_id, enrollment_id, channel, purpose, provider,
      recipient, idempotency_key, payload, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'webhook', 'transactional', 'webhook', ?, ?, ?, 'queued', ?, ?)`,
    )
    .bind(
      deliveryId,
      job.workspace_id,
      job.recipient_id,
      job.enrollment_id,
      endpoint.url,
      payload.idempotencyKey,
      JSON.stringify({ ...payload, endpointId }),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
  if (result.meta.changes === 1) {
    await env.DELIVERY_QUEUE.send({ kind: "delivery", deliveryId });
  }
}

export async function processDelivery(deliveryId: string, env: RuntimeEnv): Promise<void> {
  const delivery = await createDatabase(env.DB)
    .prepare(
      `SELECT id, workspace_id, contact_id, channel, purpose, provider, recipient,
            topic_id, idempotency_key, payload, status, attempts
     FROM deliveries WHERE id = ?`,
    )
    .bind(deliveryId)
    .first<DeliveryRow>();
  if (!delivery || !["queued", "failed"].includes(delivery.status)) return;

  const claimed = await createDatabase(env.DB)
    .prepare(
      `UPDATE deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('queued', 'failed')`,
    )
    .bind(new Date().toISOString(), delivery.id)
    .run();
  if (claimed.meta.changes !== 1) return;

  try {
    if (delivery.contact_id) {
      const gate = await readConsentGate(delivery, env);
      const decision = evaluateSendEligibility(delivery.purpose, gate);
      if (!decision.allowed) {
        await createDatabase(env.DB)
          .prepare(
            "UPDATE deliveries SET status = 'suppressed', last_error = ?, updated_at = ? WHERE id = ?",
          )
          .bind(decision.reason, new Date().toISOString(), delivery.id)
          .run();
        return;
      }
    }
    const payload = JSON.parse(delivery.payload) as ChannelMessage & { endpointId?: string };
    const adapter = await deliveryAdapter(delivery, payload.endpointId, env);
    const result = await adapter.send(payload);
    const now = new Date().toISOString();
    const eventId = uuidv7();
    await createDatabase(env.DB).batch([
      createDatabase(env.DB)
        .prepare(
          `UPDATE deliveries SET status = 'accepted', provider_message_id = ?,
         last_error = NULL, updated_at = ? WHERE id = ? AND status = 'sending'`,
        )
        .bind(result.providerMessageId, now, delivery.id),
      createDatabase(env.DB)
        .prepare(
          `INSERT OR IGNORE INTO delivery_events
         (id, workspace_id, delivery_id, provider, provider_event_id,
          provider_message_id, type, occurred_at, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, '{}', ?)`,
        )
        .bind(
          eventId,
          delivery.workspace_id,
          delivery.id,
          delivery.provider,
          `accepted:${delivery.id}`,
          result.providerMessageId,
          result.acceptedAt,
          now,
        ),
    ]);
  } catch (error) {
    const permanent = error instanceof PermanentChannelError;
    const delay = retryDelaySeconds(delivery.attempts + 1);
    await createDatabase(env.DB)
      .prepare(
        `UPDATE deliveries SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'sending'`,
      )
      .bind(
        permanent ? "failed" : "queued",
        permanent ? null : new Date(Date.now() + delay * 1000).toISOString(),
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        new Date().toISOString(),
        delivery.id,
      )
      .run();
    if (!permanent) throw new TransientChannelError("Delivery will be retried");
  }
}

export async function deliveryAdapter(
  delivery: DeliveryRow,
  endpointId: string | undefined,
  env: RuntimeEnv,
) {
  if (delivery.provider === "cloudflare") return new CloudflareEmailAdapter(env.EMAIL);
  if (delivery.provider === "resend") {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) throw new PermanentChannelError("Resend is not configured");
    return new ResendEmailAdapter({
      apiKey,
      ...(env.RESEND_WEBHOOK_SECRET ? { webhookSecret: env.RESEND_WEBHOOK_SECRET } : {}),
    });
  }
  if (delivery.provider === "postmark") {
    throw new PermanentChannelError(
      "Legacy Postmark delivery cannot be sent; recreate it with the Resend provider",
    );
  }
  if (!endpointId) throw new PermanentChannelError("Webhook endpoint is missing");
  const endpoint = await createDatabase(env.DB)
    .prepare(
      `SELECT url, encrypted_secret FROM webhook_endpoints
     WHERE workspace_id = ? AND id = ? AND enabled = 1`,
    )
    .bind(delivery.workspace_id, endpointId)
    .first<{ url: string; encrypted_secret: string }>();
  if (!endpoint) throw new PermanentChannelError("Webhook endpoint is disabled or missing");
  const secret = await decryptCredentials<{ secret: string }>(
    env.CREDENTIAL_ENCRYPTION_KEY,
    endpoint.encrypted_secret,
  );
  return new OutboundWebhookAdapter({ url: endpoint.url, secret: secret.secret });
}

export async function readConsentGate(delivery: DeliveryRow, env: RuntimeEnv) {
  const [contact, suppression, subscription, frequency] = await createDatabase(env.DB).batch([
    createDatabase(env.DB)
      .prepare("SELECT status FROM contacts WHERE workspace_id = ? AND id = ? LIMIT 1")
      .bind(delivery.workspace_id, delivery.contact_id),
    createDatabase(env.DB)
      .prepare(
        `SELECT reason FROM suppressions
       WHERE workspace_id = ? AND (contact_id = ? OR email = ?) LIMIT 1`,
      )
      .bind(delivery.workspace_id, delivery.contact_id, delivery.recipient),
    createDatabase(env.DB)
      .prepare(
        `SELECT status FROM contact_subscriptions
       WHERE workspace_id = ? AND contact_id = ? AND topic_id = ?`,
      )
      .bind(delivery.workspace_id, delivery.contact_id, delivery.topic_id),
    createDatabase(env.DB)
      .prepare(
        `SELECT COUNT(*) AS count FROM deliveries
       WHERE workspace_id = ? AND contact_id = ? AND purpose = 'marketing'
         AND status IN ('accepted', 'delivered') AND created_at >= datetime('now', '-1 day')`,
      )
      .bind(delivery.workspace_id, delivery.contact_id),
  ]);
  const contactRow = contact?.results[0] as { status?: string } | undefined;
  const suppressionReason = suppression?.results[0] as { reason?: string } | undefined;
  const subscriptionStatus = subscription?.results[0] as { status?: string } | undefined;
  const count = frequency?.results[0] as { count?: number } | undefined;
  const topicStatus =
    delivery.topic_id && subscriptionStatus?.status
      ? (subscriptionStatus.status as "subscribed" | "unsubscribed" | "pending")
      : undefined;
  return {
    ...(contactRow?.status
      ? { contactStatus: contactRow.status as "active" | "archived" | "anonymous" }
      : {}),
    globalStatus:
      suppressionReason?.reason === "global_unsubscribe"
        ? ("unsubscribed" as const)
        : ("subscribed" as const),
    suppressed: Boolean(suppressionReason),
    ...(topicStatus ? { topicStatus } : {}),
    frequency: {
      sentInWindow: count?.count ?? 0,
      limit: 3,
    },
  };
}

export async function readMessageVariables(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const result = await database
    .prepare(
      `SELECT key, value FROM message_variables
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY key`,
    )
    .bind(workspaceId)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(result.results.map((variable) => [variable.key, variable.value]));
}

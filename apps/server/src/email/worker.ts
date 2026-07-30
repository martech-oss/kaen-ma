import PostalMime from "postal-mime";

import { createDatabase, uuidv7 } from "@kaenma/database";

import { verifySignedToken } from "../crypto";
import type { RuntimeEnv } from "../env";

const maximumInboundSize = 5 * 1024 * 1024;

export async function email(message: ForwardableEmailMessage, env: RuntimeEnv): Promise<void> {
  if (message.rawSize > maximumInboundSize) {
    message.setReject("Message exceeds Kaenma's 5 MB inbound limit");
    return;
  }
  const localPart = message.to.split("@")[0] ?? "";
  if (!localPart.startsWith("r+")) {
    message.setReject("Unknown reply address");
    return;
  }
  const payload = await verifySignedToken(env.TRACKING_SIGNING_SECRET, localPart.slice(2), "reply");
  if (!payload?.contactId) {
    message.setReject("Reply address is invalid or expired");
    return;
  }
  const delivery = await createDatabase(env.DB)
    .prepare(
      `SELECT id FROM deliveries
     WHERE workspace_id = ? AND id = ? AND contact_id = ?`,
    )
    .bind(payload.workspaceId, payload.resourceId, payload.contactId)
    .first<{ id: string }>();
  if (!delivery) {
    message.setReject("Reply destination no longer exists");
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const inboundId = uuidv7();
  const receivedAt = new Date().toISOString();
  const attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    r2Key: string;
  }> = [];
  for (const [index, attachment] of parsed.attachments.entries()) {
    const filename = sanitizeFilename(attachment.filename ?? `attachment-${index + 1}`);
    const content =
      typeof attachment.content === "string"
        ? new TextEncoder().encode(attachment.content)
        : attachment.content;
    const r2Key = `${payload.workspaceId}/inbound/${inboundId}/${index}-${filename}`;
    await env.ASSETS_BUCKET.put(r2Key, content, {
      httpMetadata: {
        contentType: attachment.mimeType ?? "application/octet-stream",
      },
      customMetadata: { inboundId },
    });
    attachments.push({
      filename,
      contentType: attachment.mimeType ?? "application/octet-stream",
      size: content.byteLength,
      r2Key,
    });
  }
  const eventId = uuidv7();
  await createDatabase(env.DB).batch([
    createDatabase(env.DB)
      .prepare(
        `INSERT INTO inbound_emails
       (id, workspace_id, contact_id, delivery_id, message_id, sender, recipient,
        subject, text_body, html_body, attachment_manifest, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        inboundId,
        payload.workspaceId,
        payload.contactId,
        delivery.id,
        parsed.messageId ?? null,
        message.from,
        message.to,
        parsed.subject?.slice(0, 998) ?? null,
        parsed.text?.slice(0, 1_000_000) ?? null,
        parsed.html?.slice(0, 1_000_000) ?? null,
        JSON.stringify(attachments),
        receivedAt,
      ),
    createDatabase(env.DB)
      .prepare(
        `INSERT OR IGNORE INTO delivery_events
       (id, workspace_id, delivery_id, provider, provider_event_id,
        type, occurred_at, metadata, created_at)
       VALUES (?, ?, ?, 'cloudflare', ?, 'replied', ?, ?, ?)`,
      )
      .bind(
        eventId,
        payload.workspaceId,
        delivery.id,
        parsed.messageId ?? `reply:${inboundId}`,
        receivedAt,
        JSON.stringify({ inboundId, subject: parsed.subject ?? "" }),
        receivedAt,
      ),
    createDatabase(env.DB)
      .prepare(
        `INSERT INTO contact_events
       (id, workspace_id, contact_id, type, resource_type, resource_id,
        properties, occurred_at, created_at)
       VALUES (?, ?, ?, 'email_replied', 'delivery', ?, ?, ?, ?)`,
      )
      .bind(
        uuidv7(),
        payload.workspaceId,
        payload.contactId,
        delivery.id,
        JSON.stringify({ inboundId }),
        receivedAt,
        receivedAt,
      ),
  ]);
}

function sanitizeFilename(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 191);
}

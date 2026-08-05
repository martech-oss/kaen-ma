import { PermanentChannelError, type ChannelMessage } from "@openengage/channels";
import { compileSegmentFilter } from "@openengage/core";
import {
  BroadcastWorkerRepository,
  MessagingWorkerRepository,
  uuidv7,
  type BroadcastContactRecord,
  type BroadcastDeliveryOutcome,
  type BroadcastSendRecord,
} from "@openengage/database";

import { type RuntimeEnv } from "../env";
import { senderForPurpose } from "../messaging/delivery-worker";
import { buildReplyAddress } from "../messaging/reply-address";
import { parseTemplateVariables, resolveTemplateVariables } from "../messaging/resend";
import { createSignedToken } from "../platform/crypto";
import { parseJsonRecord } from "../platform/values";
import { type QueueMessage as OpenEngageQueueMessage } from "../runtime/queues";

export type BroadcastRow = BroadcastSendRecord;
export type BroadcastContactRow = BroadcastContactRecord;

export async function processBroadcastBatch(
  broadcastId: string,
  phase: "snapshot" | "delivery",
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const repository = new BroadcastWorkerRepository(env.DB);
  const broadcast = await repository.findSendingBroadcast(broadcastId);
  if (!broadcast) return;
  if (phase === "snapshot") {
    await snapshotBroadcastRecipients(repository, broadcast, cursor, env);
    return;
  }
  await createBroadcastDeliveries(repository, broadcast, cursor, env);
}

export async function snapshotBroadcastRecipients(
  repository: BroadcastWorkerRepository,
  broadcast: BroadcastRow,
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const batchSize = 100;
  let rows: BroadcastContactRow[];
  if (broadcast.segmentKind === "static") {
    rows = await repository.listStaticSegmentContacts(
      broadcast.workspaceId,
      broadcast.segmentId,
      broadcast.startedAt,
      cursor ?? "",
      batchSize,
    );
  } else {
    if (!broadcast.filterAst) {
      throw new PermanentChannelError("Dynamic broadcast segment has no filter");
    }
    const filter = JSON.parse(broadcast.filterAst) as Parameters<typeof compileSegmentFilter>[1];
    const compiled = compileSegmentFilter(broadcast.workspaceId, filter);
    rows = await repository.listDynamicSegmentContacts(
      compiled,
      broadcast.startedAt,
      cursor ?? "",
      batchSize,
    );
  }
  if (rows.length > 0) {
    await repository.insertBroadcastRecipients(
      broadcast.workspaceId,
      broadcast.id,
      rows.map((contact) => contact.id),
      broadcast.startedAt,
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
  repository: BroadcastWorkerRepository,
  broadcast: BroadcastRow,
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const batchSize = 40;
  const recipients = await repository.listPendingBroadcastRecipients(
    broadcast.workspaceId,
    broadcast.id,
    cursor ?? "",
    batchSize,
  );
  const templateVariables = parseTemplateVariables(broadcast.variables);
  const message = await new MessagingWorkerRepository(env.DB).readMessageVariables(
    broadcast.workspaceId,
  );
  const outcomes: BroadcastDeliveryOutcome[] = [];
  const deliveryMessages: Array<{ body: OpenEngageQueueMessage }> = [];
  for (const contact of recipients) {
    if (!contact.email) {
      outcomes.push({ kind: "skip", contactId: contact.id });
      continue;
    }
    const deliveryId = uuidv7();
    const contactData = {
      email: contact.email,
      first_name: contact.firstName,
      last_name: contact.lastName,
      phone: contact.phone,
      stage: contact.stage,
      score: contact.score,
      ...parseJsonRecord(contact.customFields),
    };
    const unsubscribeToken = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
      workspaceId: broadcast.workspaceId,
      resourceId: broadcast.topicId ?? "global",
      contactId: contact.id,
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      purpose: "unsubscribe",
    });
    const unsubscribeUrl = `${env.APP_URL}/u/${unsubscribeToken}`;
    const variables = resolveTemplateVariables(templateVariables, {
      contact: contactData,
      customFields: parseJsonRecord(contact.customFields),
      message,
      unsubscribeUrl,
      preferenceUrl: `${env.APP_URL}/preference/${unsubscribeToken}`,
    });
    const payload: ChannelMessage = {
      kind: "email",
      idempotencyKey: `${broadcast.id}:${contact.id}`,
      workspaceId: broadcast.workspaceId,
      deliveryId,
      purpose: "marketing",
      to: contact.email,
      from: senderForPurpose(env, "marketing"),
      replyTo: await buildReplyAddress(env, broadcast.workspaceId, deliveryId, contact.id),
      template: { id: broadcast.resendTemplateId, variables },
      metadata: {
        broadcastId: broadcast.id,
        unsubscribeUrl,
      },
    };
    outcomes.push({
      kind: "queue",
      contactId: contact.id,
      delivery: {
        id: deliveryId,
        recipient: contact.email,
        topicId: broadcast.topicId,
        templateId: broadcast.templateId,
        idempotencyKey: payload.idempotencyKey,
        payload: JSON.stringify(payload),
      },
    });
    deliveryMessages.push({
      body: { kind: "delivery", deliveryId },
    });
  }
  await repository.applyBroadcastDeliveryOutcomes(broadcast.workspaceId, broadcast.id, outcomes);
  if (deliveryMessages.length > 0) await env.DELIVERY_QUEUE.sendBatch(deliveryMessages);
  const last = recipients.at(-1);
  if (recipients.length === batchSize && last) {
    await env.CAMPAIGN_QUEUE.send({
      kind: "broadcast_batch",
      broadcastId: broadcast.id,
      phase: "delivery",
      cursor: last.id,
    });
  } else {
    await repository.completeSendingBroadcast(broadcast.id);
  }
}

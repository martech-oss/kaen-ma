import {
  OutboundWebhookAdapter,
  PermanentChannelError,
  ResendEmailAdapter,
  TransientChannelError,
  type ChannelMessage,
} from "@kaenma/channels";
import { evaluateSendEligibility, retryDelaySeconds } from "@kaenma/core";
import {
  ConsentRepository,
  MessagingWorkerRepository,
  uuidv7,
  type DeliveryClaimRecord,
} from "@kaenma/database";
import { type CampaignNode } from "@kaenma/orpc";

import { type AutomationJobRow } from "../automations/worker";
import { type RuntimeEnv } from "../env";
import { buildReplyAddress } from "../messaging/reply-address";
import { parseTemplateVariables, resolveTemplateVariables } from "../messaging/resend";
import { createSignedToken, decryptCredentials } from "../platform/crypto";
import { parseJsonRecord } from "../platform/values";

export type DeliveryRow = DeliveryClaimRecord;

export async function createEmailDelivery(
  action: Extract<CampaignNode, { type: "action" }>["config"] & {
    action: "send_email";
  },
  job: AutomationJobRow,
  env: RuntimeEnv,
): Promise<void> {
  if (!job.contact_email) throw new PermanentChannelError("Contact does not have an email");
  const repository = new MessagingWorkerRepository(env.DB);
  const template = await repository.findSendableTemplate(job.workspace_id, action.templateId);
  if (!template) throw new PermanentChannelError("Email template is missing");
  if (template.remoteStatus !== "published" || template.syncError) {
    throw new PermanentChannelError(template.syncError ?? "Email template is not published");
  }
  const message = await repository.readMessageVariables(job.workspace_id);
  const customFields = parseJsonRecord(job.custom_fields);
  const contact = {
    email: job.contact_email,
    first_name: job.first_name,
    last_name: job.last_name,
    phone: job.phone,
    stage: job.stage,
    score: job.score,
  };
  const unsubscribeToken =
    template.purpose === "marketing"
      ? await createSignedToken(env.TRACKING_SIGNING_SECRET, {
          workspaceId: job.workspace_id,
          resourceId: action.topicId ?? "global",
          contactId: job.contact_id,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          purpose: "unsubscribe",
        })
      : null;
  const deliveryId = uuidv7();
  const unsubscribeUrl = unsubscribeToken ? `${env.APP_URL}/u/${unsubscribeToken}` : undefined;
  const preferenceUrl = unsubscribeToken
    ? `${env.APP_URL}/preference/${unsubscribeToken}`
    : undefined;
  const variables = resolveTemplateVariables(parseTemplateVariables(template.variables), {
    contact,
    customFields,
    message,
    ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
    ...(preferenceUrl ? { preferenceUrl } : {}),
  });
  const replyTo = await buildReplyAddress(env, job.workspace_id, deliveryId, job.contact_id);
  const payload: ChannelMessage = {
    kind: "email",
    idempotencyKey: `${job.idempotency_key}:email`,
    workspaceId: job.workspace_id,
    deliveryId,
    purpose: template.purpose,
    to: job.contact_email,
    from: senderForPurpose(env, template.purpose),
    replyTo,
    template: { id: template.resendTemplateId, variables },
    ...(unsubscribeUrl ? { metadata: { unsubscribeUrl } } : {}),
  };
  const created = await repository.insertQueuedDelivery({
    id: deliveryId,
    workspaceId: job.workspace_id,
    contactId: job.contact_id,
    enrollmentId: job.enrollment_id,
    channel: "email",
    purpose: template.purpose,
    provider: "resend",
    recipient: job.contact_email,
    topicId: action.topicId ?? null,
    templateId: template.id,
    idempotencyKey: payload.idempotencyKey,
    payload: JSON.stringify(payload),
  });
  if (created) {
    await env.DELIVERY_QUEUE.send({ kind: "delivery", deliveryId });
  }
}

export async function createWebhookDelivery(
  endpointId: string,
  job: AutomationJobRow,
  env: RuntimeEnv,
): Promise<void> {
  const repository = new MessagingWorkerRepository(env.DB);
  const endpoint = await repository.findEnabledWebhookEndpoint(job.workspace_id, endpointId);
  if (!endpoint) throw new PermanentChannelError("Webhook endpoint is missing");
  const deliveryId = uuidv7();
  const payload: ChannelMessage = {
    kind: "webhook",
    idempotencyKey: `${job.idempotency_key}:webhook`,
    workspaceId: job.workspace_id,
    deliveryId,
    payload: {
      contactId: job.contact_id,
      enrollmentId: job.enrollment_id,
    },
  };
  const created = await repository.insertQueuedDelivery({
    id: deliveryId,
    workspaceId: job.workspace_id,
    contactId: job.contact_id,
    enrollmentId: job.enrollment_id,
    channel: "webhook",
    purpose: "transactional",
    provider: "webhook",
    recipient: endpoint.url,
    idempotencyKey: payload.idempotencyKey,
    payload: JSON.stringify({ ...payload, endpointId }),
  });
  if (created) {
    await env.DELIVERY_QUEUE.send({ kind: "delivery", deliveryId });
  }
}

export async function processDelivery(deliveryId: string, env: RuntimeEnv): Promise<void> {
  const repository = new MessagingWorkerRepository(env.DB);
  const delivery = await repository.findDeliveryForProcessing(deliveryId);
  if (!delivery || !["queued", "failed"].includes(delivery.status)) return;

  const claimed = await repository.claimDelivery(delivery.id);
  if (!claimed) return;

  try {
    if (delivery.contactId) {
      const gate = await readConsentGate(delivery, env);
      const decision = evaluateSendEligibility(delivery.purpose, gate);
      if (!decision.allowed) {
        await repository.markDeliverySuppressed(delivery.id, decision.reason);
        return;
      }
    }
    const payload = JSON.parse(delivery.payload) as ChannelMessage & { endpointId?: string };
    const adapter = await deliveryAdapter(delivery, payload.endpointId, env);
    const result = await adapter.send(payload);
    await repository.markDeliveryAccepted({
      deliveryId: delivery.id,
      workspaceId: delivery.workspaceId,
      provider: delivery.provider,
      providerMessageId: result.providerMessageId,
      acceptedAt: result.acceptedAt,
    });
  } catch (error) {
    const permanent = error instanceof PermanentChannelError;
    const delay = retryDelaySeconds(delivery.attempts + 1);
    await repository.recordDeliveryAttemptFailure(delivery.id, {
      status: permanent ? "failed" : "queued",
      nextAttemptAt: permanent ? null : new Date(Date.now() + delay * 1000).toISOString(),
      lastError:
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    });
    if (!permanent) throw new TransientChannelError("Delivery will be retried");
  }
}

export async function deliveryAdapter(
  delivery: DeliveryRow,
  endpointId: string | undefined,
  env: RuntimeEnv,
) {
  if (delivery.provider === "resend") {
    const apiKey = env.RESEND_SEND_API_KEY;
    if (!apiKey) throw new PermanentChannelError("Resend is not configured");
    return new ResendEmailAdapter({
      apiKey,
      ...(env.RESEND_WEBHOOK_SECRET ? { webhookSecret: env.RESEND_WEBHOOK_SECRET } : {}),
    });
  }
  if (!endpointId) throw new PermanentChannelError("Webhook endpoint is missing");
  const endpoint = await new MessagingWorkerRepository(env.DB).findEnabledWebhookEndpointWithSecret(
    delivery.workspaceId,
    endpointId,
  );
  if (!endpoint) throw new PermanentChannelError("Webhook endpoint is disabled or missing");
  const secret = await decryptCredentials<{ secret: string }>(
    env.CREDENTIAL_ENCRYPTION_KEY,
    endpoint.encryptedSecret,
  );
  return new OutboundWebhookAdapter({ url: endpoint.url, secret: secret.secret });
}

export function senderForPurpose(
  env: RuntimeEnv,
  purpose: "marketing" | "transactional",
): { email: string; name?: string } {
  return purpose === "marketing"
    ? { email: env.MARKETING_FROM_EMAIL, name: env.MARKETING_FROM_NAME }
    : { email: env.TRANSACTIONAL_FROM_EMAIL, name: env.TRANSACTIONAL_FROM_NAME };
}

export async function readConsentGate(delivery: DeliveryRow, env: RuntimeEnv) {
  const rows = await new ConsentRepository(env.DB, {
    workspaceId: delivery.workspaceId,
  }).readConsentGateRows({
    contactId: delivery.contactId,
    recipient: delivery.recipient,
    topicId: delivery.topicId,
  });
  const topicStatus =
    delivery.topicId && rows.topicStatus
      ? (rows.topicStatus as "subscribed" | "unsubscribed" | "pending")
      : undefined;
  return {
    ...(rows.contactStatus
      ? { contactStatus: rows.contactStatus as "active" | "archived" | "anonymous" }
      : {}),
    globalStatus:
      rows.suppressionReason === "global_unsubscribe"
        ? ("unsubscribed" as const)
        : ("subscribed" as const),
    suppressed: Boolean(rows.suppressionReason),
    ...(topicStatus ? { topicStatus } : {}),
    frequency: {
      sentInWindow: rows.marketingSentInWindow,
      limit: 3,
    },
  };
}

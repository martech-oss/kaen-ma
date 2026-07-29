import {
  CloudflareEmailAdapter,
  OutboundWebhookAdapter,
  PermanentChannelError,
  ResendEmailAdapter,
  TransientChannelError,
  type ChannelMessage,
} from "@kaenma/channels";
import {
  compileSegmentFilter,
  computeDueAt,
  evaluateSendEligibility,
  outgoingEdges,
  retryDelaySeconds,
} from "@kaenma/core";
import { claimDueJobs, uuidv7 } from "@kaenma/db";
import { renderContent, renderSubject } from "@kaenma/email-renderer";
import {
  campaignDefinitionSchema,
  campaignQueueMessageSchema,
  broadcastQueueMessageSchema,
  contactExportQueueMessageSchema,
  contactImportQueueMessageSchema,
  contentDocumentSchema,
  deliveryQueueMessageSchema,
  type CampaignDefinition,
  type CampaignEdge,
  type CampaignNode,
  type QueueMessage as KaenmaQueueMessage,
} from "@kaenma/shared";
import { buildReplyAddress } from "./app";
import { createSignedToken, decryptCredentials } from "./crypto";
import type { RuntimeEnv } from "./env";

interface CampaignJobRow {
  id: string;
  workspace_id: string;
  enrollment_id: string;
  campaign_version_id: string;
  node_id: string;
  recipient_id: string;
  idempotency_key: string;
  payload: string;
  status: string;
  lease_id: string | null;
  attempts: number;
  created_at: string;
  graph: string;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  stage: string;
  score: number;
  custom_fields: string;
}

interface DeliveryRow {
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

interface BroadcastRow {
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

interface BroadcastContactRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  stage: string;
  score: number;
  custom_fields: string;
}

export async function scheduled(
  controller: ScheduledController,
  env: RuntimeEnv,
  context: ExecutionContext,
): Promise<void> {
  if (controller.cron === "17 3 * * *") {
    context.waitUntil(runDailyMaintenance(env));
    return;
  }
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  const workspaces = await env.DB.prepare(
    `SELECT workspace_id, MIN(due_at) AS oldest
     FROM campaign_jobs
     WHERE status = 'pending' AND due_at <= ?
     GROUP BY workspace_id ORDER BY oldest ASC LIMIT 50`,
  )
    .bind(now)
    .all<{ workspace_id: string }>();
  const messages: Array<{ body: KaenmaQueueMessage }> = [];
  for (const workspace of workspaces.results) {
    const jobs = await claimDueJobs(env.DB, now, leaseUntil, 20, workspace.workspace_id);
    for (const job of jobs) {
      messages.push({
        body: { kind: "campaign_job", jobId: job.id, leaseId: job.leaseId },
      });
    }
  }
  if (messages.length > 0) await env.CAMPAIGN_QUEUE.sendBatch(messages);

  const scheduledBroadcasts = await env.DB.prepare(
    `SELECT id FROM broadcasts
     WHERE status = 'scheduled' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 20`,
  )
    .bind(now)
    .all<{ id: string }>();
  for (const broadcast of scheduledBroadcasts.results) {
    const result = await env.DB.prepare(
      `UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, ?),
       updated_at = ? WHERE id = ? AND status = 'scheduled'`,
    )
      .bind(now, now, broadcast.id)
      .run();
    if (result.meta.changes === 1) {
      await env.CAMPAIGN_QUEUE.send({
        kind: "broadcast_batch",
        broadcastId: broadcast.id,
        phase: "snapshot",
      });
    }
  }

  const dueDeliveries = await env.DB.prepare(
    `SELECT id FROM deliveries
     WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT 100`,
  )
    .bind(now)
    .all<{ id: string }>();
  if (dueDeliveries.results.length > 0) {
    await env.DELIVERY_QUEUE.sendBatch(
      dueDeliveries.results.map((delivery) => ({
        body: { kind: "delivery", deliveryId: delivery.id },
      })),
    );
  }
}

export async function queue(
  batch: MessageBatch<unknown>,
  env: RuntimeEnv,
): Promise<void> {
  for (const message of batch.messages) {
    if (batch.queue === "kaenma-dead-letter") {
      await persistDeadLetter(batch.queue, message.body, message.attempts, env);
      message.ack();
      continue;
    }
    try {
      if (batch.queue === "kaenma-campaign") {
        const campaign = campaignQueueMessageSchema.safeParse(message.body);
        const broadcast = broadcastQueueMessageSchema.safeParse(message.body);
        const contactImport = contactImportQueueMessageSchema.safeParse(message.body);
        const contactExport = contactExportQueueMessageSchema.safeParse(message.body);
        if (campaign.success) {
          await processCampaignJob(campaign.data.jobId, campaign.data.leaseId, env);
        } else if (broadcast.success) {
          await processBroadcastBatch(
            broadcast.data.broadcastId,
            broadcast.data.phase,
            broadcast.data.cursor,
            env,
          );
        } else if (contactImport.success) {
          await processContactImport(
            contactImport.data.importJobId,
            contactImport.data.part,
            contactImport.data.totalParts,
            env,
          );
        } else if (contactExport.success) {
          await processContactExport(contactExport.data.exportJobId, env);
        } else {
          throw new PermanentChannelError("Invalid campaign queue message");
        }
      } else if (batch.queue === "kaenma-delivery") {
        const parsed = deliveryQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) throw new PermanentChannelError("Invalid delivery queue message");
        await processDelivery(parsed.data.deliveryId, env);
      } else {
        throw new PermanentChannelError(`Unknown queue: ${batch.queue}`);
      }
      message.ack();
    } catch (error) {
      console.error("Queue message failed", {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof PermanentChannelError) {
        await persistDeadLetter(batch.queue, message.body, message.attempts, env, error.message);
        message.ack();
      } else {
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      }
    }
  }
}

async function processContactImport(
  jobId: string,
  part: number,
  totalParts: number,
  env: RuntimeEnv,
): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT workspace_id, r2_key, status FROM import_jobs
     WHERE id = ? AND kind = 'contact_import' AND status IN ('pending', 'processing')`,
  )
    .bind(jobId)
    .first<{ workspace_id: string; r2_key: string; status: string }>();
  if (!job) return;
  await env.DB.prepare(
    "UPDATE import_jobs SET status = 'processing', updated_at = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), jobId)
    .run();
  const object = await env.ASSETS_BUCKET.get(`${job.r2_key}/part-${part}.ndjson`);
  if (!object) throw new PermanentChannelError(`Import part ${part} is missing`);
  const lines = (await object.text()).split("\n").filter(Boolean);
  let succeeded = 0;
  let failed = 0;
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const line of lines) {
    try {
      const source = safeRecord(line);
      const email =
        typeof source["email"] === "string" && source["email"].trim()
          ? source["email"].trim().toLowerCase()
          : null;
      const externalId =
        typeof source["external_id"] === "string" && source["external_id"].trim()
          ? source["external_id"].trim()
          : null;
      if (!email && !externalId) {
        failed += 1;
        continue;
      }
      const customFields = { ...source };
      for (const key of [
        "email",
        "external_id",
        "first_name",
        "last_name",
        "phone",
        "stage",
      ]) {
        delete customFields[key];
      }
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO contacts
           (id, workspace_id, email, first_name, last_name, phone, external_id,
            stage, score, status, custom_fields, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
        ).bind(
          uuidv7(),
          job.workspace_id,
          email,
          stringValue(source["first_name"]),
          stringValue(source["last_name"]),
          stringValue(source["phone"]),
          externalId,
          stringValue(source["stage"]) ?? "lead",
          JSON.stringify(customFields),
          now,
          now,
        ),
      );
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  if (statements.length > 0) await env.DB.batch(statements);
  const finished = part + 1 >= totalParts;
  await env.DB.prepare(
    `UPDATE import_jobs SET status = ?, cursor = ?, processed = processed + ?,
     succeeded = succeeded + ?, failed = failed + ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      finished ? "completed" : "processing",
      JSON.stringify({ part: part + 1, totalParts }),
      lines.length,
      succeeded,
      failed,
      new Date().toISOString(),
      jobId,
    )
    .run();
  if (!finished) {
    await env.CAMPAIGN_QUEUE.send({
      kind: "contact_import",
      importJobId: jobId,
      part: part + 1,
      totalParts,
    });
  }
}

async function processContactExport(jobId: string, env: RuntimeEnv): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT workspace_id, r2_key, status, cursor FROM import_jobs
     WHERE id = ? AND kind = 'contact_export' AND status IN ('pending', 'processing')`,
  )
    .bind(jobId)
    .first<{
      workspace_id: string;
      r2_key: string;
      status: string;
      cursor: string;
    }>();
  if (!job) return;
  const cursor = safeRecord(job.cursor);
  const lastId = typeof cursor["lastId"] === "string" ? cursor["lastId"] : "";
  const partNumber = typeof cursor["partNumber"] === "number" ? cursor["partNumber"] : 0;
  const batchSize = 1_000;
  const contacts = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, phone, external_id, stage, score,
            status, custom_fields, created_at, updated_at
     FROM contacts WHERE workspace_id = ? AND id > ?
     ORDER BY id ASC LIMIT ?`,
  )
    .bind(job.workspace_id, lastId, batchSize)
    .all<Record<string, unknown>>();
  if (contacts.results.length > 0) {
    const header =
      partNumber === 0
        ? "id,email,first_name,last_name,phone,external_id,stage,score,status,custom_fields,created_at,updated_at\n"
        : "";
    const body =
      header +
      contacts.results
        .map((contact) =>
          [
            contact["id"],
            contact["email"],
            contact["first_name"],
            contact["last_name"],
            contact["phone"],
            contact["external_id"],
            contact["stage"],
            contact["score"],
            contact["status"],
            contact["custom_fields"],
            contact["created_at"],
            contact["updated_at"],
          ]
            .map(csvCell)
            .join(","),
        )
        .join("\n") +
      "\n";
    await env.ASSETS_BUCKET.put(`${job.r2_key}.parts/${partNumber}.csv`, body, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
    });
    const last = contacts.results.at(-1);
    await env.DB.prepare(
      `UPDATE import_jobs SET status = 'processing', cursor = ?,
       processed = processed + ?, succeeded = succeeded + ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        JSON.stringify({
          partNumber: partNumber + 1,
          lastId: String(last?.["id"] ?? lastId),
        }),
        contacts.results.length,
        contacts.results.length,
        new Date().toISOString(),
        jobId,
      )
      .run();
  }
  if (contacts.results.length === batchSize) {
    await env.CAMPAIGN_QUEUE.send({ kind: "contact_export", exportJobId: jobId });
    return;
  }
  const chunks: ArrayBuffer[] = [];
  for (let index = 0; index < partNumber + (contacts.results.length > 0 ? 1 : 0); index += 1) {
    const part = await env.ASSETS_BUCKET.get(`${job.r2_key}.parts/${index}.csv`);
    if (!part) throw new PermanentChannelError(`Export part ${index} is missing`);
    chunks.push(await part.arrayBuffer());
  }
  await env.ASSETS_BUCKET.put(job.r2_key, new Blob(chunks), {
    httpMetadata: {
      contentType: "text/csv; charset=utf-8",
      contentDisposition: `attachment; filename="kaenma-contacts-${jobId}.csv"`,
    },
  });
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE import_jobs SET status = 'completed', updated_at = ? WHERE id = ?",
  )
    .bind(now, jobId)
    .run();
}

async function processCampaignJob(
  jobId: string,
  leaseId: string,
  env: RuntimeEnv,
): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT j.*, cv.graph,
            c.email AS contact_email, c.first_name, c.last_name, c.phone,
            c.stage, c.score, c.custom_fields
     FROM campaign_jobs j
     JOIN campaign_versions cv ON cv.id = j.campaign_version_id
       AND cv.workspace_id = j.workspace_id
     JOIN contacts c ON c.id = j.recipient_id AND c.workspace_id = j.workspace_id
     WHERE j.id = ? AND j.lease_id = ? AND j.status IN ('leased', 'running')`,
  )
    .bind(jobId, leaseId)
    .first<CampaignJobRow>();
  if (!job) return;
  const claimed = await env.DB.prepare(
    `UPDATE campaign_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND lease_id = ? AND status = 'leased'`,
  )
    .bind(new Date().toISOString(), jobId, leaseId)
    .run();
  if (claimed.meta.changes === 0 && job.status !== "running") return;

  try {
    const definition = campaignDefinitionSchema.parse(JSON.parse(job.graph));
    const node = definition.nodes.find((candidate) => candidate.id === job.node_id);
    if (!node) throw new PermanentChannelError(`Campaign node ${job.node_id} is missing`);
    const result = await executeNode(node, definition, job, env);
    if (result.waitUntil) {
      await env.DB.prepare(
        `UPDATE campaign_jobs SET status = 'pending', due_at = ?, payload = ?,
         lease_id = NULL, lease_until = NULL, updated_at = ?
         WHERE id = ? AND lease_id = ? AND status = 'running'`,
      )
        .bind(
          result.waitUntil,
          JSON.stringify({ waiting: true }),
          new Date().toISOString(),
          job.id,
          leaseId,
        )
        .run();
      return;
    }
    await finishNode(job, leaseId, definition, result.branch, env);
  } catch (error) {
    await env.DB.prepare(
      `UPDATE campaign_jobs SET status = 'leased', last_error = ?, updated_at = ?
       WHERE id = ? AND lease_id = ? AND status = 'running'`,
    )
      .bind(
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        new Date().toISOString(),
        job.id,
        leaseId,
      )
      .run();
    throw error;
  }
}

async function processBroadcastBatch(
  broadcastId: string,
  phase: "snapshot" | "delivery",
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const broadcast = await env.DB.prepare(
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

async function snapshotBroadcastRecipients(
  broadcast: BroadcastRow,
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const batchSize = 100;
  let rows: BroadcastContactRow[];
  if (broadcast.segment_kind === "static") {
    const result = await env.DB.prepare(
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
    const result = await env.DB.prepare(
      `${compiled.sql} AND c.updated_at <= ? AND c.id > ? AND c.status = 'active'
       ORDER BY c.id ASC LIMIT ?`,
    )
      .bind(...compiled.params, broadcast.started_at, cursor ?? "", batchSize)
      .all<BroadcastContactRow>();
    rows = result.results;
  }
  if (rows.length > 0) {
    await env.DB.batch(
      rows.map((contact) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO broadcast_recipients
           (workspace_id, broadcast_id, contact_id, status, snapshot_at)
           VALUES (?, ?, ?, 'pending', ?)`,
        ).bind(
          broadcast.workspace_id,
          broadcast.id,
          contact.id,
          broadcast.started_at,
        ),
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

async function createBroadcastDeliveries(
  broadcast: BroadcastRow,
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const batchSize = 40;
  const recipients = await env.DB.prepare(
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
  const statements: D1PreparedStatement[] = [];
  const deliveryMessages: Array<{ body: KaenmaQueueMessage }> = [];
  for (const contact of recipients.results) {
    if (!contact.email) {
      statements.push(
        env.DB.prepare(
          `UPDATE broadcast_recipients SET status = 'skipped'
           WHERE workspace_id = ? AND broadcast_id = ? AND contact_id = ?`,
        ).bind(broadcast.workspace_id, broadcast.id, contact.id),
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
      replyTo: await buildReplyAddress(
        env,
        broadcast.workspace_id,
        deliveryId,
        contact.id,
      ),
      subject: renderSubject(broadcast.subject, { contact: contactData, workspace: {} }),
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
      env.DB.prepare(
        `INSERT OR IGNORE INTO deliveries
         (id, workspace_id, contact_id, broadcast_id, channel, purpose, provider,
          recipient, topic_id, template_version_id, idempotency_key, payload,
          status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'email', 'marketing', 'resend', ?, ?, ?, ?, ?,
                 'queued', ?, ?)`,
      ).bind(
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
      env.DB.prepare(
        `UPDATE broadcast_recipients SET status = 'queued'
         WHERE workspace_id = ? AND broadcast_id = ? AND contact_id = ? AND status = 'pending'`,
      ).bind(broadcast.workspace_id, broadcast.id, contact.id),
    );
    deliveryMessages.push({
      body: { kind: "delivery", deliveryId },
    });
  }
  if (statements.length > 0) await env.DB.batch(statements);
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
    await env.DB.prepare(
      `UPDATE broadcasts SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'sending'`,
    )
      .bind(now, now, broadcast.id)
      .run();
  }
}

async function executeNode(
  node: CampaignNode,
  definition: CampaignDefinition,
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<{ branch?: CampaignEdge["branch"]; waitUntil?: string }> {
  if (node.type === "source") return { branch: "next" };
  if (node.type === "delay") {
    return {
      branch: "next",
      waitUntil: computeDueAt(node, new Date(), definition.timezone).toISOString(),
    };
  }
  if (node.type === "condition") {
    return { branch: (await evaluateCondition(node, job, env)) ? "yes" : "no" };
  }
  if (node.type === "decision") {
    const eventType = {
      opened: "email_opened",
      clicked: "email_clicked",
      replied: "email_replied",
      page_viewed: "page_viewed",
      form_submitted: "form_submitted",
    }[node.config.event];
    const found = await env.DB.prepare(
      `SELECT id FROM contact_events
       WHERE workspace_id = ? AND contact_id = ? AND type = ?
         AND occurred_at >= ? AND (? IS NULL OR resource_id = ?)
       LIMIT 1`,
    )
      .bind(
        job.workspace_id,
        job.recipient_id,
        eventType,
        job.created_at,
        node.config.resourceId ?? null,
        node.config.resourceId ?? null,
      )
      .first();
    if (found) return { branch: "yes" };
    const payload = safeRecord(job.payload);
    if (payload["waiting"] === true) return { branch: "timeout" };
    return {
      waitUntil: new Date(Date.now() + node.config.withinMinutes * 60_000).toISOString(),
    };
  }

  const action = node.config;
  const now = new Date().toISOString();
  switch (action.action) {
    case "send_email":
      await createEmailDelivery(action, job, env);
      break;
    case "send_webhook":
      await createWebhookDelivery(action.endpointId, job, env);
      break;
    case "add_tag":
      await env.DB.prepare(
        `INSERT OR IGNORE INTO contact_tags
         (workspace_id, contact_id, tag_id, created_at) VALUES (?, ?, ?, ?)`,
      )
        .bind(job.workspace_id, job.recipient_id, action.tagId, now)
        .run();
      break;
    case "remove_tag":
      await env.DB.prepare(
        "DELETE FROM contact_tags WHERE workspace_id = ? AND contact_id = ? AND tag_id = ?",
      )
        .bind(job.workspace_id, job.recipient_id, action.tagId)
        .run();
      break;
    case "add_segment":
      await env.DB.prepare(
        `INSERT OR IGNORE INTO segment_memberships
         (workspace_id, segment_id, contact_id, source, joined_at)
         VALUES (?, ?, ?, 'campaign', ?)`,
      )
        .bind(job.workspace_id, action.segmentId, job.recipient_id, now)
        .run();
      break;
    case "remove_segment":
      await env.DB.prepare(
        `DELETE FROM segment_memberships
         WHERE workspace_id = ? AND segment_id = ? AND contact_id = ?`,
      )
        .bind(job.workspace_id, action.segmentId, job.recipient_id)
        .run();
      break;
    case "change_score": {
      const current = await env.DB.prepare(
        `SELECT score FROM contacts WHERE workspace_id = ? AND id = ?`,
      )
        .bind(job.workspace_id, job.recipient_id)
        .first<{ score: number }>();
      const total = (current?.score ?? 0) + action.amount;
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE contacts SET score = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        ).bind(total, now, job.workspace_id, job.recipient_id),
        env.DB.prepare(
          `INSERT INTO score_events
           (id, workspace_id, contact_id, delta, total, reason, campaign_enrollment_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'campaign', ?, ?)`,
        ).bind(
          uuidv7(),
          job.workspace_id,
          job.recipient_id,
          action.amount,
          total,
          job.enrollment_id,
          now,
        ),
      ]);
      break;
    }
    case "update_field":
      await updateContactField(job, action.field, action.value, env);
      break;
  }
  return { branch: "next" };
}

async function createEmailDelivery(
  action: Extract<CampaignNode, { type: "action" }>["config"] & {
    action: "send_email";
  },
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<void> {
  if (!job.contact_email) throw new PermanentChannelError("Contact does not have an email");
  const template = await env.DB.prepare(
    `SELECT subject, content_document FROM email_template_versions
     WHERE workspace_id = ? AND id = ?`,
  )
    .bind(job.workspace_id, action.templateVersionId)
    .first<{ subject: string; content_document: string }>();
  if (!template) throw new PermanentChannelError("Email template version is missing");
  const content = contentDocumentSchema.parse(JSON.parse(template.content_document));
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
    unsubscribeUrl: `${env.APP_URL}/u/${unsubscribeToken}`,
    preferenceUrl: `${env.APP_URL}/preference/${unsubscribeToken}`,
  });
  const html = rendered.html.replace(
    "</body>",
    `<img src="${env.APP_URL}/t/${trackingToken}" width="1" height="1" alt="" style="display:none"></body>`,
  );
  const replyTo = await buildReplyAddress(
    env,
    job.workspace_id,
    deliveryId,
    job.recipient_id,
  );
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
    subject: renderSubject(template.subject, { contact, workspace: {} }),
    html,
    text: rendered.text,
    ...(action.purpose === "marketing"
      ? { metadata: { unsubscribeUrl: `${env.APP_URL}/u/${unsubscribeToken}` } }
      : {}),
  };
  const result = await env.DB.prepare(
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

async function createWebhookDelivery(
  endpointId: string,
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<void> {
  const endpoint = await env.DB.prepare(
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
  const result = await env.DB.prepare(
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

async function finishNode(
  job: CampaignJobRow,
  leaseId: string,
  definition: CampaignDefinition,
  branch: CampaignEdge["branch"] | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const next = outgoingEdges(definition, job.node_id, branch ?? "next")[0];
  const now = new Date().toISOString();
  if (!next) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE campaign_jobs SET status = 'succeeded', lease_id = NULL,
         lease_until = NULL, updated_at = ? WHERE id = ? AND lease_id = ?`,
      ).bind(now, job.id, leaseId),
      env.DB.prepare(
        `UPDATE campaign_enrollments SET status = 'completed', current_node_id = NULL,
         completed_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
      ).bind(now, now, job.workspace_id, job.enrollment_id),
    ]);
    return;
  }
  const nextJobId = uuidv7();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE campaign_jobs SET status = 'succeeded', lease_id = NULL,
       lease_until = NULL, updated_at = ? WHERE id = ? AND lease_id = ?`,
    ).bind(now, job.id, leaseId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO campaign_jobs
       (id, workspace_id, enrollment_id, campaign_version_id, node_id,
        recipient_id, idempotency_key, status, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(
      nextJobId,
      job.workspace_id,
      job.enrollment_id,
      job.campaign_version_id,
      next.target,
      job.recipient_id,
      `${job.enrollment_id}:${next.target}:${job.recipient_id}`,
      now,
      now,
      now,
    ),
    env.DB.prepare(
      `UPDATE campaign_enrollments SET current_node_id = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'active'`,
    ).bind(next.target, now, job.workspace_id, job.enrollment_id),
  ]);
}

async function evaluateCondition(
  node: Extract<CampaignNode, { type: "condition" }>,
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<boolean> {
  const fieldMap: Record<string, unknown> = {
    email: job.contact_email,
    first_name: job.first_name,
    last_name: job.last_name,
    phone: job.phone,
    stage: job.stage,
    score: job.score,
    ...safeRecord(job.custom_fields),
  };
  if (node.config.field === "tag") {
    const row = await env.DB.prepare(
      `SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.workspace_id = ? AND ct.contact_id = ? AND t.slug = ? LIMIT 1`,
    )
      .bind(job.workspace_id, job.recipient_id, String(node.config.value ?? ""))
      .first();
    return compare(row !== null, node.config.operator, true);
  }
  return compare(fieldMap[node.config.field], node.config.operator, node.config.value);
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  if (operator === "exists") return left !== null && left !== undefined;
  if (operator === "not_exists") return left === null || left === undefined;
  if (operator === "eq") return String(left ?? "") === String(right ?? "");
  if (operator === "neq") return String(left ?? "") !== String(right ?? "");
  if (operator === "contains") return String(left ?? "").includes(String(right ?? ""));
  if (operator === "starts_with") return String(left ?? "").startsWith(String(right ?? ""));
  if (operator === "in") {
    return Array.isArray(right) && right.some((value) => String(value) === String(left));
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  if (operator === "lte") return leftNumber <= rightNumber;
  return false;
}

async function updateContactField(
  job: CampaignJobRow,
  field: string,
  value: unknown,
  env: RuntimeEnv,
): Promise<void> {
  const columns: Record<string, string> = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    stage: "stage",
    external_id: "external_id",
  };
  const column = columns[field];
  if (column) {
    await env.DB.prepare(
      `UPDATE contacts SET ${column} = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
    )
      .bind(String(value ?? ""), new Date().toISOString(), job.workspace_id, job.recipient_id)
      .run();
    return;
  }
  if (!/^[A-Za-z0-9_.-]{1,191}$/.test(field)) {
    throw new PermanentChannelError("Invalid custom field key");
  }
  const fields = safeRecord(job.custom_fields);
  fields[field] = value;
  await env.DB.prepare(
    "UPDATE contacts SET custom_fields = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
  )
    .bind(
      JSON.stringify(fields),
      new Date().toISOString(),
      job.workspace_id,
      job.recipient_id,
    )
    .run();
}

async function processDelivery(deliveryId: string, env: RuntimeEnv): Promise<void> {
  const delivery = await env.DB.prepare(
    `SELECT id, workspace_id, contact_id, channel, purpose, provider, recipient,
            topic_id, idempotency_key, payload, status, attempts
     FROM deliveries WHERE id = ?`,
  )
    .bind(deliveryId)
    .first<DeliveryRow>();
  if (!delivery || !["queued", "failed"].includes(delivery.status)) return;

  const claimed = await env.DB.prepare(
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
        await env.DB.prepare(
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
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE deliveries SET status = 'accepted', provider_message_id = ?,
         last_error = NULL, updated_at = ? WHERE id = ? AND status = 'sending'`,
      ).bind(result.providerMessageId, now, delivery.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO delivery_events
         (id, workspace_id, delivery_id, provider, provider_event_id,
          provider_message_id, type, occurred_at, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, '{}', ?)`,
      ).bind(
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
    await env.DB.prepare(
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

async function deliveryAdapter(
  delivery: DeliveryRow,
  endpointId: string | undefined,
  env: RuntimeEnv,
) {
  if (delivery.provider === "cloudflare") return new CloudflareEmailAdapter(env.EMAIL);
  if (delivery.provider === "resend") {
    const config = await env.DB.prepare(
      `SELECT encrypted_credentials FROM provider_configs
       WHERE workspace_id = ? AND provider = 'resend' AND enabled = 1
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(delivery.workspace_id)
      .first<{ encrypted_credentials: string }>();
    const credentials = config
      ? await decryptCredentials<{ apiKey: string; webhookSecret?: string }>(
          env.CREDENTIAL_ENCRYPTION_KEY,
          config.encrypted_credentials,
        )
      : null;
    const apiKey = credentials?.apiKey ?? env.RESEND_API_KEY;
    if (!apiKey) throw new PermanentChannelError("Resend is not configured");
    return new ResendEmailAdapter({
      apiKey,
      ...(credentials?.webhookSecret || env.RESEND_WEBHOOK_SECRET
        ? { webhookSecret: credentials?.webhookSecret ?? env.RESEND_WEBHOOK_SECRET }
        : {}),
    });
  }
  if (delivery.provider === "postmark") {
    throw new PermanentChannelError(
      "Legacy Postmark delivery cannot be sent; recreate it with the Resend provider",
    );
  }
  if (!endpointId) throw new PermanentChannelError("Webhook endpoint is missing");
  const endpoint = await env.DB.prepare(
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

async function readConsentGate(delivery: DeliveryRow, env: RuntimeEnv) {
  const [suppression, subscription, frequency] = await env.DB.batch([
    env.DB.prepare(
      `SELECT reason FROM suppressions
       WHERE workspace_id = ? AND (contact_id = ? OR email = ?) LIMIT 1`,
    ).bind(delivery.workspace_id, delivery.contact_id, delivery.recipient),
    env.DB.prepare(
      `SELECT status FROM contact_subscriptions
       WHERE workspace_id = ? AND contact_id = ? AND topic_id = ?`,
    ).bind(delivery.workspace_id, delivery.contact_id, delivery.topic_id),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM deliveries
       WHERE workspace_id = ? AND contact_id = ? AND purpose = 'marketing'
         AND status IN ('accepted', 'delivered') AND created_at >= datetime('now', '-1 day')`,
    ).bind(delivery.workspace_id, delivery.contact_id),
  ]);
  const suppressionReason = suppression?.results[0] as { reason?: string } | undefined;
  const subscriptionStatus = subscription?.results[0] as { status?: string } | undefined;
  const count = frequency?.results[0] as { count?: number } | undefined;
  const topicStatus =
    delivery.topic_id && subscriptionStatus?.status
      ? (subscriptionStatus.status as "subscribed" | "unsubscribed" | "pending")
      : undefined;
  return {
    globalStatus:
      suppressionReason?.reason === "global_unsubscribe" ? "unsubscribed" as const : "subscribed" as const,
    suppressed: Boolean(suppressionReason),
    ...(topicStatus ? { topicStatus } : {}),
    frequency: {
      sentInWindow: count?.count ?? 0,
      limit: 3,
    },
  };
}

async function persistDeadLetter(
  queueName: string,
  body: unknown,
  attempts: number,
  env: RuntimeEnv,
  error = "Queue retries exhausted",
): Promise<void> {
  const parsed = body as { jobId?: string; deliveryId?: string };
  let workspaceId: string | null = null;
  if (parsed.jobId) {
    workspaceId =
      (
        await env.DB.prepare("SELECT workspace_id FROM campaign_jobs WHERE id = ?")
          .bind(parsed.jobId)
          .first<{ workspace_id: string }>()
      )?.workspace_id ?? null;
  } else if (parsed.deliveryId) {
    workspaceId =
      (
        await env.DB.prepare("SELECT workspace_id FROM deliveries WHERE id = ?")
          .bind(parsed.deliveryId)
          .first<{ workspace_id: string }>()
      )?.workspace_id ?? null;
  }
  await env.DB.prepare(
    `INSERT INTO dead_letters
     (id, workspace_id, source_queue, message_body, error, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuidv7(),
      workspaceId,
      queueName,
      JSON.stringify(body),
      error,
      attempts,
      new Date().toISOString(),
    )
    .run();
}

async function runDailyMaintenance(env: RuntimeEnv): Promise<void> {
  const retentionDays = Math.max(1, Number(env.RAW_EVENT_RETENTION_DAYS) || 90);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const events = await env.DB.prepare(
    `SELECT id, workspace_id, contact_id, visitor_id, type, resource_type,
            resource_id, properties, occurred_at
     FROM contact_events WHERE occurred_at < ? AND archived_at IS NULL
     ORDER BY occurred_at ASC LIMIT 1000`,
  )
    .bind(cutoff)
    .all<Record<string, unknown>>();
  if (events.results.length > 0) {
    const firstWorkspace = String(events.results[0]?.["workspace_id"] ?? "unknown");
    const key = `${firstWorkspace}/archives/contact-events/${new Date().toISOString()}.${uuidv7()}.ndjson`;
    await env.ASSETS_BUCKET.put(
      key,
      events.results.map((event) => JSON.stringify(event)).join("\n"),
      { httpMetadata: { contentType: "application/x-ndjson" } },
    );
    for (let offset = 0; offset < events.results.length; offset += 50) {
      const chunk = events.results.slice(offset, offset + 50);
      await env.DB.batch(
        chunk.map((event) =>
          env.DB.prepare(
            "UPDATE contact_events SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
          ).bind(new Date().toISOString(), event["id"]),
        ),
      );
    }
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO daily_metrics
     (workspace_id, metric_date, dimension_type, dimension_id,
      accepted, delivered, opened, clicked, bounced, complained, unsubscribed, failed)
     SELECT workspace_id, substr(occurred_at, 1, 10), 'workspace', workspace_id,
       SUM(type = 'accepted'), SUM(type = 'delivered'), SUM(type = 'opened'),
       SUM(type = 'clicked'), SUM(type = 'bounced'), SUM(type = 'complained'),
       SUM(type = 'unsubscribed'), SUM(type = 'failed')
     FROM delivery_events WHERE substr(occurred_at, 1, 10) = ?
     GROUP BY workspace_id, substr(occurred_at, 1, 10)
     ON CONFLICT(workspace_id, metric_date, dimension_type, dimension_id)
     DO UPDATE SET accepted = excluded.accepted, delivered = excluded.delivered,
       opened = excluded.opened, clicked = excluded.clicked, bounced = excluded.bounced,
       complained = excluded.complained, unsubscribed = excluded.unsubscribed,
       failed = excluded.failed`,
  )
    .bind(yesterday)
    .run();
  await env.DB.prepare("DELETE FROM idempotency_keys WHERE expires_at < ?")
    .bind(new Date().toISOString())
    .run();
}

function safeRecord(value: string): Record<string, unknown>;
function safeRecord(value: unknown): Record<string, unknown>;
function safeRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return safeRecord(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function csvCell(value: unknown): string {
  let rendered =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}

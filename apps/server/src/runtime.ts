import { PermanentChannelError } from "@kaenma/channels";
import { retryDelaySeconds } from "@kaenma/core";
import { claimDueJobs, createDatabase } from "@kaenma/database";
import {
  campaignQueueMessageSchema,
  broadcastQueueMessageSchema,
  contactExportQueueMessageSchema,
  contactImportQueueMessageSchema,
  deliveryQueueMessageSchema,
  type QueueMessage as KaenmaQueueMessage,
} from "@kaenma/shared";

import { processBroadcastBatch } from "./broadcasts/worker";
import { enrollInactiveContacts } from "./campaigns/enrollment";
import { processCampaignJob } from "./campaigns/worker";
import { processContactExport, processContactImport } from "./contacts/worker";
import { processDelivery } from "./deliveries/worker";
import { type RuntimeEnv } from "./env";
import { persistDeadLetter, runDailyMaintenance } from "./operations/worker";

export async function scheduled(
  controller: ScheduledController,
  env: RuntimeEnv,
  context: ExecutionContext,
): Promise<void> {
  if (controller.cron === "17 3 * * *") {
    context.waitUntil(runDailyMaintenance(env));
    return;
  }
  await enrollInactiveContacts(createDatabase(env.DB));
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  const workspaces = await createDatabase(env.DB)
    .prepare(
      `SELECT workspace_id, MIN(due_at) AS oldest
     FROM campaign_jobs
     WHERE status = 'pending' AND due_at <= ?
     GROUP BY workspace_id ORDER BY oldest ASC LIMIT 50`,
    )
    .bind(now)
    .all<{ workspace_id: string }>();
  const messages: Array<{ body: KaenmaQueueMessage }> = [];
  for (const workspace of workspaces.results) {
    const jobs = await claimDueJobs(
      createDatabase(env.DB),
      now,
      leaseUntil,
      20,
      workspace.workspace_id,
    );
    for (const job of jobs) {
      messages.push({
        body: { kind: "campaign_job", jobId: job.id, leaseId: job.leaseId },
      });
    }
  }
  if (messages.length > 0) await env.CAMPAIGN_QUEUE.sendBatch(messages);

  const scheduledBroadcasts = await createDatabase(env.DB)
    .prepare(
      `SELECT id FROM broadcasts
     WHERE status = 'scheduled' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 20`,
    )
    .bind(now)
    .all<{ id: string }>();
  for (const broadcast of scheduledBroadcasts.results) {
    const result = await createDatabase(env.DB)
      .prepare(
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

  const dueDeliveries = await createDatabase(env.DB)
    .prepare(
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

export async function queue(batch: MessageBatch<unknown>, env: RuntimeEnv): Promise<void> {
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

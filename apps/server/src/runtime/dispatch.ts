import { PermanentChannelError } from "@kaenma/channels";
import { retryDelaySeconds } from "@kaenma/core";
import { claimDueJobs, createDatabase } from "@kaenma/database";

import { enrollInactiveContacts } from "../automations/enrollment";
import { processCampaignJob } from "../automations/worker";
import { processBroadcastBatch } from "../broadcasts/worker";
import { processContactExport, processContactImport } from "../contacts/worker";
import { type RuntimeEnv } from "../env";
import { processDelivery } from "../messaging/delivery-worker";
import { logError } from "../observability";
import { persistDeadLetter, runDailyMaintenance } from "../platform/maintenance-worker";
import {
  campaignQueueBatchMessageSchema,
  deliveryQueueMessageSchema,
  type QueueMessage as KaenmaQueueMessage,
} from "./queues";

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
        const parsed = campaignQueueBatchMessageSchema.safeParse(message.body);
        if (!parsed.success) throw new PermanentChannelError("Invalid campaign queue message");
        switch (parsed.data.kind) {
          case "campaign_job":
            await processCampaignJob(parsed.data.jobId, parsed.data.leaseId, env);
            break;
          case "broadcast_batch":
            await processBroadcastBatch(
              parsed.data.broadcastId,
              parsed.data.phase,
              parsed.data.cursor,
              env,
            );
            break;
          case "contact_import":
            await processContactImport(
              parsed.data.importJobId,
              parsed.data.part,
              parsed.data.totalParts,
              env,
            );
            break;
          case "contact_export":
            await processContactExport(parsed.data.exportJobId, env);
            break;
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
      logError("queue.message_failed", error, {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
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

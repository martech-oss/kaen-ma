import { PermanentChannelError } from "@kaenma/channels";
import { retryDelaySeconds } from "@kaenma/core";
import {
  BroadcastWorkerRepository,
  AutomationEngineRepository,
  claimDueJobs,
  createDatabase,
  MessagingWorkerRepository,
} from "@kaenma/database";

import { enrollInactiveContacts } from "../automations/enrollment";
import { processAutomationJob } from "../automations/worker";
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
  const database = createDatabase(env.DB);
  await enrollInactiveContacts(database);
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  const engine = new AutomationEngineRepository(database);
  const workspaces = await engine.workspacesWithDueJobs(now, 50);
  const messages: Array<{ body: KaenmaQueueMessage }> = [];
  for (const workspace of workspaces) {
    const jobs = await claimDueJobs(database, now, leaseUntil, 20, workspace.workspaceId);
    for (const job of jobs) {
      messages.push({
        body: { kind: "campaign_job", jobId: job.id, leaseId: job.leaseId },
      });
    }
  }
  if (messages.length > 0) await env.CAMPAIGN_QUEUE.sendBatch(messages);

  const broadcastWorker = new BroadcastWorkerRepository(database);
  for (const broadcast of await broadcastWorker.listDueScheduledBroadcasts(now)) {
    if (await broadcastWorker.promoteScheduledBroadcast(broadcast.id, now)) {
      await env.CAMPAIGN_QUEUE.send({
        kind: "broadcast_batch",
        broadcastId: broadcast.id,
        phase: "snapshot",
      });
    }
  }

  const dueDeliveries = await new MessagingWorkerRepository(database).scanDueDeliveries(now);
  if (dueDeliveries.length > 0) {
    await env.DELIVERY_QUEUE.sendBatch(
      dueDeliveries.map((delivery) => ({
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
            await processAutomationJob(parsed.data.jobId, parsed.data.leaseId, env);
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

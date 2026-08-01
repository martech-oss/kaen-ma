import { createDatabase, uuidv7 } from "@kaenma/database";

import { type RuntimeEnv } from "../env";
import { primitiveString } from "../platform/values";

export async function persistDeadLetter(
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
        await createDatabase(env.DB)
          .prepare("SELECT workspace_id FROM campaign_jobs WHERE id = ?")
          .bind(parsed.jobId)
          .first<{ workspace_id: string }>()
      )?.workspace_id ?? null;
  } else if (parsed.deliveryId) {
    workspaceId =
      (
        await createDatabase(env.DB)
          .prepare("SELECT workspace_id FROM deliveries WHERE id = ?")
          .bind(parsed.deliveryId)
          .first<{ workspace_id: string }>()
      )?.workspace_id ?? null;
  }
  await createDatabase(env.DB)
    .prepare(
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

export async function runDailyMaintenance(env: RuntimeEnv): Promise<void> {
  const retentionDays = Math.max(1, Number(env.RAW_EVENT_RETENTION_DAYS) || 90);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const events = await createDatabase(env.DB)
    .prepare(
      `SELECT id, workspace_id, contact_id, visitor_id, type, resource_type,
            resource_id, properties, occurred_at
     FROM contact_events WHERE occurred_at < ? AND archived_at IS NULL
     ORDER BY occurred_at ASC LIMIT 1000`,
    )
    .bind(cutoff)
    .all<Record<string, unknown>>();
  if (events.results.length > 0) {
    const firstWorkspace = primitiveString(events.results[0]?.["workspace_id"], "unknown");
    const key = `${firstWorkspace}/archives/contact-events/${new Date().toISOString()}.${uuidv7()}.ndjson`;
    await env.ASSETS_BUCKET.put(
      key,
      events.results.map((event) => JSON.stringify(event)).join("\n"),
      { httpMetadata: { contentType: "application/x-ndjson" } },
    );
    for (let offset = 0; offset < events.results.length; offset += 50) {
      const chunk = events.results.slice(offset, offset + 50);
      await createDatabase(env.DB).batch(
        chunk.map((event) =>
          createDatabase(env.DB)
            .prepare(
              "UPDATE contact_events SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
            )
            .bind(new Date().toISOString(), event["id"]),
        ),
      );
    }
  }
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await createDatabase(env.DB)
    .prepare(
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
  await createDatabase(env.DB)
    .prepare("DELETE FROM idempotency_keys WHERE expires_at < ?")
    .bind(new Date().toISOString())
    .run();
}

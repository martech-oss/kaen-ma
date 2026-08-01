import type { KaenmaDatabase } from "@kaenma/database";
import type { DeadLetterRow } from "@kaenma/orpc";

import { nullablePrimitiveString, numericValue, primitiveString } from "./values";

export async function listDeadLetters(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<DeadLetterRow[]> {
  const result = await database
    .prepare(
      `SELECT id, source_queue, error, attempts, status, created_at, replayed_at
       FROM dead_letters WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: primitiveString(row["id"]),
    sourceQueue: primitiveString(row["source_queue"]),
    error: nullablePrimitiveString(row["error"]),
    attempts: numericValue(row["attempts"]),
    status: primitiveString(row["status"]) as DeadLetterRow["status"],
    createdAt: primitiveString(row["created_at"]),
    replayedAt: nullablePrimitiveString(row["replayed_at"]),
  }));
}

export type DeadLetterReplayOutcome = { kind: "not_found" } | { kind: "replayed" };

export async function replayDeadLetter(
  database: KaenmaDatabase,
  queues: { campaign: Queue; delivery: Queue },
  workspaceId: string,
  deadLetterId: string,
): Promise<DeadLetterReplayOutcome> {
  const row = await database
    .prepare(
      `SELECT id, source_queue, message_body FROM dead_letters
       WHERE workspace_id = ? AND id = ? AND status = 'pending'`,
    )
    .bind(workspaceId, deadLetterId)
    .first<{ id: string; source_queue: string; message_body: string }>();
  if (!row) return { kind: "not_found" };
  const body: unknown = JSON.parse(row.message_body);
  if (row.source_queue === "kaenma-campaign") {
    await queues.campaign.send(body);
  } else {
    await queues.delivery.send(body);
  }
  await database
    .prepare(
      "UPDATE dead_letters SET status = 'replayed', replayed_at = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(new Date().toISOString(), row.id)
    .run();
  return { kind: "replayed" };
}

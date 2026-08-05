import { DeadLetterRepository, type OpenEngageDatabase } from "@openengage/database";
import type { DeadLetterRow } from "@openengage/orpc";

export async function listDeadLetters(
  database: OpenEngageDatabase,
  workspaceId: string,
): Promise<DeadLetterRow[]> {
  return new DeadLetterRepository(database).list(workspaceId);
}

export type DeadLetterReplayOutcome = { kind: "not_found" } | { kind: "replayed" };

export async function replayDeadLetter(
  database: OpenEngageDatabase,
  queues: { campaign: Queue; delivery: Queue },
  workspaceId: string,
  deadLetterId: string,
): Promise<DeadLetterReplayOutcome> {
  const repository = new DeadLetterRepository(database);
  const row = await repository.findPendingForReplay(workspaceId, deadLetterId);
  if (!row) return { kind: "not_found" };
  const body: unknown = JSON.parse(row.messageBody);
  if (row.sourceQueue === "openengage-campaign") {
    await queues.campaign.send(body);
  } else {
    await queues.delivery.send(body);
  }
  await repository.markReplayed(row.id, new Date().toISOString());
  return { kind: "replayed" };
}

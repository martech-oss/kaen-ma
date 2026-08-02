import { and, desc, eq } from "drizzle-orm";

import { campaignJobs } from "../automations/schema";
import { createDatabase, type DatabaseSource } from "../client";
import { deliveries } from "../messaging/schema";
import { deadLetters } from "./schema";

export interface DeadLetterRecord {
  id: string;
  sourceQueue: string;
  error: string | null;
  attempts: number;
  status: "pending" | "replayed" | "discarded";
  createdAt: string;
  replayedAt: string | null;
}

/** Repository for the dead_letters table and the source lookups used to file one. */
export class DeadLetterRepository {
  public constructor(private readonly database: DatabaseSource) {}

  public async findJobWorkspace(jobId: string): Promise<string | null> {
    const [row] = await createDatabase(this.database)
      .orm.select({ workspaceId: campaignJobs.workspaceId })
      .from(campaignJobs)
      .where(eq(campaignJobs.id, jobId))
      .limit(1);
    return row?.workspaceId ?? null;
  }

  public async findDeliveryWorkspace(deliveryId: string): Promise<string | null> {
    const [row] = await createDatabase(this.database)
      .orm.select({ workspaceId: deliveries.workspaceId })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);
    return row?.workspaceId ?? null;
  }

  public async insert(input: {
    id: string;
    workspaceId: string | null;
    sourceQueue: string;
    messageBody: string;
    error: string;
    attempts: number;
    createdAt: string;
  }): Promise<void> {
    await createDatabase(this.database).orm.insert(deadLetters).values({
      id: input.id,
      workspaceId: input.workspaceId,
      sourceQueue: input.sourceQueue,
      messageBody: input.messageBody,
      error: input.error,
      attempts: input.attempts,
      createdAt: input.createdAt,
    });
  }

  public async list(workspaceId: string, limit = 100): Promise<DeadLetterRecord[]> {
    const rows = await createDatabase(this.database)
      .orm.select()
      .from(deadLetters)
      .where(eq(deadLetters.workspaceId, workspaceId))
      .orderBy(desc(deadLetters.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      sourceQueue: row.sourceQueue,
      error: row.error,
      attempts: row.attempts,
      status: row.status as DeadLetterRecord["status"],
      createdAt: row.createdAt,
      replayedAt: row.replayedAt,
    }));
  }

  public async findPendingForReplay(
    workspaceId: string,
    deadLetterId: string,
  ): Promise<{ id: string; sourceQueue: string; messageBody: string } | null> {
    const [row] = await createDatabase(this.database)
      .orm.select({
        id: deadLetters.id,
        sourceQueue: deadLetters.sourceQueue,
        messageBody: deadLetters.messageBody,
      })
      .from(deadLetters)
      .where(
        and(
          eq(deadLetters.workspaceId, workspaceId),
          eq(deadLetters.id, deadLetterId),
          eq(deadLetters.status, "pending"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async markReplayed(deadLetterId: string, now: string): Promise<boolean> {
    const result = await createDatabase(this.database)
      .orm.update(deadLetters)
      .set({ status: "replayed", replayedAt: now })
      .where(and(eq(deadLetters.id, deadLetterId), eq(deadLetters.status, "pending")));
    return result.meta.changes === 1;
  }
}

import { createDatabase, type DatabaseSource } from "../client";
import { idempotencyKeys } from "./schema";

export async function reserveIdempotencyKey(
  database: DatabaseSource,
  workspaceId: string,
  scope: string,
  key: string,
  expiresAt: string,
): Promise<boolean> {
  const result = await createDatabase(database)
    .orm.insert(idempotencyKeys)
    .values({
      workspaceId,
      scope,
      idempotencyKey: key,
      createdAt: new Date().toISOString(),
      expiresAt,
    })
    .onConflictDoNothing();
  return result.meta.changes === 1;
}

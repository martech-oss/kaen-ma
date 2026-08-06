import { nowIso } from "../shared/database-utils";
import { DatabaseRepository } from "../shared/repository-base";
import { idempotencyKeys } from "./schema";

export class IdempotencyRepository extends DatabaseRepository {
  public async reserve(
    workspaceId: string,
    scope: string,
    key: string,
    expiresAt: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(idempotencyKeys)
      .values({ workspaceId, scope, idempotencyKey: key, createdAt: nowIso(), expiresAt })
      .onConflictDoNothing();
    return result.meta.changes === 1;
  }
}

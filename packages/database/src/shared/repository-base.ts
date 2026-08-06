import { eq, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import type { WorkspaceContext } from "@openengage/core/shared";

import { createDatabase, type DatabaseSource, type OpenEngageDatabase } from "../client";

export type WorkspaceScope = Pick<WorkspaceContext, "workspaceId">;

/**
 * Base for every repository. Normalizes the D1-binding-or-wrapper
 * constructor argument once - `createDatabase` is WeakMap-memoized, so this
 * is behaviorally identical to re-calling it per method.
 */
export abstract class DatabaseRepository {
  protected readonly database: OpenEngageDatabase;

  public constructor(source: DatabaseSource) {
    this.database = createDatabase(source);
  }
}

/**
 * Base for every workspace-scoped repository. `Context` defaults to
 * `{ workspaceId }` for repositories some call sites can only resolve a
 * workspace id for; a full {@link WorkspaceContext} is assignable wherever
 * that narrower scope is expected. Pass the full type as the generic
 * parameter for repositories that need more (e.g. `context.userId`).
 */
export abstract class WorkspaceRepository<
  Context extends WorkspaceScope = WorkspaceScope,
> extends DatabaseRepository {
  public constructor(
    source: DatabaseSource,
    public readonly context: Context,
  ) {
    super(source);
  }

  /** `eq(table.workspaceId, this.context.workspaceId)` - the scoping condition every query needs. */
  protected inWorkspace(table: { workspaceId: AnySQLiteColumn }): SQL {
    return eq(table.workspaceId, this.context.workspaceId);
  }
}

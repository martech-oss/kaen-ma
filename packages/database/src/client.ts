import type { SQL } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import { schema } from "./schema";

export type Database = DrizzleD1Database<typeof schema>;
export type DatabaseSource = D1Database | KaenmaDatabase;

/**
 * Application-wide database entry point.
 *
 * All access goes through `orm`: the Drizzle query builder, or `sql` tagged
 * templates with `${table.column}` interpolation for the handful of queries
 * the builder can't express (see packages/database/src/*​/repository.ts).
 * `all`/`first`/`run` accept a proper drizzle `SQL` object, never a string -
 * apps/server/src contains zero raw SQL (enforced by
 * apps/server/scripts/check-no-raw-sql.mjs).
 */
export class KaenmaDatabase {
  public readonly orm: Database;

  public constructor(binding: D1Database) {
    this.orm = drizzle(binding, { schema, casing: "snake_case" });
  }

  public async all<T>(query: SQL): Promise<D1Result<T>> {
    const results = await this.orm.all<T>(query);
    return {
      results,
      success: true,
      meta: {},
    } as D1Result<T>;
  }

  public async first<T>(query: SQL): Promise<T | null> {
    return (await this.orm.get<T>(query)) ?? null;
  }

  public run(query: SQL): Promise<D1Result> {
    return this.orm.run(query);
  }
}

const databases = new WeakMap<D1Database, KaenmaDatabase>();

export function createDatabase(binding: DatabaseSource): KaenmaDatabase {
  if (binding instanceof KaenmaDatabase) return binding;
  const existing = databases.get(binding);
  if (existing) return existing;
  const database = new KaenmaDatabase(binding);
  databases.set(binding, database);
  return database;
}

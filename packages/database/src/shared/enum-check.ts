import { sql } from "drizzle-orm";
import { check, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * A CHECK constraint whose allowed values come from a shared array (usually
 * the same array backing a `@openengage/core` zod enum), so the DB constraint
 * and the API-layer validation can never drift out of sync.
 *
 * The values are embedded as SQL string literals via `sql.raw`, not bound
 * as `?` parameters - SQLite's DDL parser rejects bind parameters inside a
 * CHECK constraint ("parameters prohibited in CHECK constraints"), since it
 * must be a constant expression it can store and re-evaluate per row. Safe
 * here because every caller passes a hardcoded internal const array, never
 * user input; single quotes are still escaped defensively.
 */
export function checkEnum(name: string, column: AnySQLiteColumn, values: readonly string[]) {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
  return check(name, sql`${column} IN (${sql.raw(literals)})`);
}

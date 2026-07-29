import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { sql, type SQL } from "drizzle-orm";
import { schema } from "./schema";

export type Database = DrizzleD1Database<typeof schema>;
export type DatabaseSource = D1Database | KaenmaDatabase;

type BoundValue = unknown;

/**
 * Application-wide database entry point.
 *
 * Query Builder code uses `orm`. Complex SQL is routed through this adapter so
 * D1 access, parameter binding, and atomic D1 batches stay in one place.
 */
export class KaenmaDatabase {
  public readonly orm: Database;

  public constructor(private readonly binding: D1Database) {
    this.orm = drizzle(binding, { schema });
  }

  public prepare(query: string): DrizzleRawStatement {
    return new DrizzleRawStatement(this, query);
  }

  public async batch<T extends readonly DrizzleRawStatement[]>(
    statements: T,
  ): Promise<D1Result[]> {
    return this.binding.batch(
      statements.map((statement) => statement.toD1Statement()),
    );
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

  public nativeStatement(query: string, values: readonly BoundValue[]) {
    return this.binding.prepare(query).bind(...values);
  }
}

export class DrizzleRawStatement {
  private values: BoundValue[] = [];

  public constructor(
    private readonly database: KaenmaDatabase,
    private readonly query: string,
  ) {}

  public bind(...values: BoundValue[]): this {
    this.values = values;
    return this;
  }

  public all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.all<T>(toSql(this.query, this.values));
  }

  public first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.database.first<T>(toSql(this.query, this.values));
  }

  public run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.run(toSql(this.query, this.values)) as Promise<D1Result<T>>;
  }

  public toD1Statement(): D1PreparedStatement {
    return this.database.nativeStatement(this.query, this.values);
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

function toSql(query: string, values: readonly BoundValue[]): SQL {
  const segments = query.split("?");
  if (segments.length !== values.length + 1) {
    throw new Error(
      `SQL placeholder count mismatch: expected ${segments.length - 1}, received ${values.length}`,
    );
  }
  const chunks: SQL[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment) chunks.push(sql.raw(segment));
    if (index < values.length) chunks.push(sql`${values[index]}`);
  }
  return sql.join(chunks, sql.raw(""));
}

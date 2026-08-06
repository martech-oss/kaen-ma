import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import {
  type CompiledSegment,
  segmentFilterSchema,
  type SegmentFilter,
} from "@openengage/core/segments";

import { nowIso } from "../shared/database-utils";
import { defineJsonCodec } from "../shared/json-codec";
import { UNPAGINATED_LIST_LIMIT } from "../shared/pagination";
import { WorkspaceRepository } from "../shared/repository-base";
import { uuidv7 } from "../shared/uuid";
import { segmentMemberships, segments } from "./schema";

const filterAstCodec = defineJsonCodec(segmentFilterSchema, "segments.filter_ast");

export type SegmentRecord = Omit<typeof segments.$inferSelect, "filterAst"> & {
  filterAst: SegmentFilter | null;
};

export class SegmentRepository extends WorkspaceRepository {
  public async listSegments(): Promise<SegmentRecord[]> {
    const rows = await this.database.orm
      .select()
      .from(segments)
      .where(this.inWorkspace(segments))
      .orderBy(desc(segments.updatedAt))
      .limit(UNPAGINATED_LIST_LIMIT);
    return rows.map((row) => ({
      ...row,
      filterAst: filterAstCodec.decodeNullable(row.filterAst),
    }));
  }

  public async createSegment(input: {
    name: string;
    slug: string;
    kind: "static" | "dynamic";
    filter?: SegmentFilter | undefined;
  }): Promise<{ id: string; createdAt: string; updatedAt: string }> {
    const id = uuidv7();
    const now = nowIso();
    await this.database.orm.insert(segments).values({
      id,
      workspaceId: this.context.workspaceId,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      filterAst: input.filter ? filterAstCodec.encode(input.filter) : null,
      createdAt: now,
      updatedAt: now,
    });
    return { id, createdAt: now, updatedAt: now };
  }

  /**
   * Loads the fields a membership refresh needs. `kind` intentionally stays a
   * plain string: callers treat anything that is not "static" as dynamic.
   */
  public async findSegmentDefinition(
    id: string,
  ): Promise<{ kind: string; filterAst: SegmentFilter | null } | null> {
    const [row] = await this.database.orm
      .select({ kind: segments.kind, filterAst: segments.filterAst })
      .from(segments)
      .where(and(this.inWorkspace(segments), eq(segments.id, id)))
      .limit(1);
    return row ? { ...row, filterAst: filterAstCodec.decodeNullable(row.filterAst) } : null;
  }

  /** Recomputes the denormalized `member_count` of one segment. */
  public async updateMemberCount(segmentId: string): Promise<void> {
    await this.database.orm
      .update(segments)
      .set({ memberCount: memberCountExpression(), updatedAt: nowIso() })
      .where(and(this.inWorkspace(segments), eq(segments.id, segmentId)));
  }

  /**
   * Atomically (one D1 batch) replaces the dynamic memberships of a segment
   * with the contacts matched by the compiled filter, then refreshes the
   * denormalized member count and evaluation timestamp.
   */
  public async replaceDynamicMemberships(
    segmentId: string,
    compiled: CompiledSegment,
  ): Promise<void> {
    const now = nowIso();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .delete(segmentMemberships)
        .where(
          and(
            this.inWorkspace(segmentMemberships),
            eq(segmentMemberships.segmentId, segmentId),
            eq(segmentMemberships.source, "dynamic"),
          ),
        ),
      // insert-from-select: drizzle emits the full column list in declaration
      // order, so the SELECT below lists workspace_id, segment_id, contact_id,
      // source, joined_at in exactly that order.
      orm
        .insert(segmentMemberships)
        .select(
          sql`SELECT ${this.context.workspaceId}, ${segmentId}, matched.id, 'dynamic', ${now}
              FROM (${compiledFilterSql(compiled)}) matched
              WHERE matched.status != 'archived'`,
        )
        .onConflictDoNothing(),
      orm
        .update(segments)
        .set({ memberCount: memberCountExpression(), evaluatedAt: now, updatedAt: now })
        .where(and(this.inWorkspace(segments), eq(segments.id, segmentId))),
    ]);
  }

  /** Runs the compiled filter and returns the matched contact rows, newest id first. */
  public async previewContacts(
    compiled: CompiledSegment,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    return await this.database.orm.all<Record<string, unknown>>(
      sql`${compiledFilterSql(compiled)} ORDER BY c.id DESC LIMIT ${limit}`,
    );
  }
}

/** Correlated subquery recomputing `segments.member_count` for the row being updated. */
function memberCountExpression(): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM ${segmentMemberships}
    WHERE ${segmentMemberships.workspaceId} = ${segments.workspaceId}
      AND ${segmentMemberships.segmentId} = ${segments.id})`;
}

/**
 * Interleaves the compiled filter's `?` placeholders with its bound
 * parameters. The SQL text comes from `compileSegmentFilter`, which only emits
 * allowlisted identifiers (never user text), so `sql.raw` is safe for these
 * chunks — and only for these chunks.
 */
function compiledFilterSql(compiled: CompiledSegment): SQL {
  const parts = compiled.sql.split("?");
  if (parts.length !== compiled.params.length + 1) {
    throw new Error(
      `Compiled segment filter placeholder mismatch: expected ${parts.length - 1}, received ${compiled.params.length}`,
    );
  }
  const chunks: SQL[] = [];
  for (const [index, part] of parts.entries()) {
    if (part) chunks.push(sql.raw(part));
    if (index < compiled.params.length) chunks.push(sql`${compiled.params[index]}`);
  }
  return sql.join(chunks, sql.raw(""));
}

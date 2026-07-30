export const listSegmentsProcedure = authed.segments.list.handler(async ({ context }) => {
  const result = await context.database
    .prepare(
      `SELECT id, name, slug, kind, filter_ast, member_count, evaluated_at, created_at, updated_at
       FROM segments WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
    )
    .bind(context.workspace.workspaceId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => {
    let filterAst = null;
    if (typeof row["filter_ast"] === "string") {
      try {
        filterAst = JSON.parse(row["filter_ast"]) as never;
      } catch {
        filterAst = null;
      }
    }
    return {
      id: primitiveString(row["id"]),
      name: primitiveString(row["name"]),
      slug: primitiveString(row["slug"]),
      kind: row["kind"] === "dynamic" ? ("dynamic" as const) : ("static" as const),
      filterAst,
      memberCount: Number(row["member_count"] ?? 0),
      evaluatedAt: row["evaluated_at"] === null ? null : primitiveString(row["evaluated_at"]),
      createdAt: primitiveString(row["created_at"]),
      updatedAt: primitiveString(row["updated_at"]),
    };
  });
});

import { uuidv7 } from "@kaenma/database";

import { hasWorkspaceRole } from "../auth/authorization";
import { authed } from "../orpc/base";
import { primitiveString } from "../values";
import { refreshSegmentMemberships } from "./routes";

export const createSegmentProcedure = authed.segments.create.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    if (input.kind === "dynamic" && !input.filter) throw errors.FILTER_REQUIRED();
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.database
      .prepare(
        `INSERT INTO segments
         (id, workspace_id, name, slug, kind, filter_ast, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        context.workspace.workspaceId,
        input.name,
        input.slug,
        input.kind,
        input.filter ? JSON.stringify(input.filter) : null,
        now,
        now,
      )
      .run();
    if (input.kind === "dynamic") {
      await refreshSegmentMemberships(context.database, context.workspace.workspaceId, id);
    }
    return {
      id,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      createdAt: now,
      updatedAt: now,
    };
  },
);

export const refreshSegmentProcedure = authed.segments.refresh.handler(
  async ({ context, input, errors }) => {
    if (!hasWorkspaceRole(context.workspace.role, "marketer")) throw errors.FORBIDDEN();
    const refreshed = await refreshSegmentMemberships(
      context.database,
      context.workspace.workspaceId,
      input.id,
    );
    if (!refreshed) throw errors.SEGMENT_NOT_FOUND();
    return { refreshed: true as const };
  },
);

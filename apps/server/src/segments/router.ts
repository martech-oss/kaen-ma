import { uuidv7 } from "@kaenma/database";

import { hasWorkspaceRole } from "../auth/authorization";
import { authed } from "../orpc/base";
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

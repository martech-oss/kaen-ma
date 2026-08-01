import { SegmentRepository } from "@kaenma/database";

import { authed, requireRole } from "../orpc/base";
import { listSegments, previewSegment } from "./list-service";
import { refreshSegmentMemberships } from "./membership-service";

export const listSegmentsProcedure = authed.segments.list.handler(async ({ context }) => {
  return listSegments(context.database, context.workspace);
});

export const createSegmentProcedure = authed.segments.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    if (input.kind === "dynamic" && !input.filter) throw errors.FILTER_REQUIRED();
    const repository = new SegmentRepository(context.database, context.workspace);
    const created = await repository.createSegment(input);
    if (input.kind === "dynamic") {
      await refreshSegmentMemberships(context.database, context.workspace.workspaceId, created.id);
    }
    return {
      id: created.id,
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  },
);

export const refreshSegmentProcedure = authed.segments.refresh.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const refreshed = await refreshSegmentMemberships(
      context.database,
      context.workspace.workspaceId,
      input.id,
    );
    if (!refreshed) throw errors.SEGMENT_NOT_FOUND();
    return { refreshed: true as const };
  },
);

export const previewSegmentProcedure = authed.segments.preview.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "analyst", errors.FORBIDDEN);
    return previewSegment(context.database, context.workspace, input.filter);
  },
);

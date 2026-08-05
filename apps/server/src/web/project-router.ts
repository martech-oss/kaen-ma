import { authed, requireRole } from "../orpc/base";
import { addProjectItem, createProject, listProjects } from "./project-service";

export const listProjectsProcedure = authed.projects.list.handler(({ context }) =>
  listProjects(context.database, context.workspace.workspaceId),
);

export const createProjectProcedure = authed.projects.create.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    return createProject(context.database, context.workspace.workspaceId, input);
  },
);

export const addProjectItemProcedure = authed.projects.addItem.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const outcome = await addProjectItem(context.database, context.workspace.workspaceId, {
      projectId: input.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });
    if (outcome.kind === "project_not_found") throw errors.PROJECT_NOT_FOUND();
    return { added: outcome.added };
  },
);

export const projectProcedures = {
  list: listProjectsProcedure,
  create: createProjectProcedure,
  addItem: addProjectItemProcedure,
};

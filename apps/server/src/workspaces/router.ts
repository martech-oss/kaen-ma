import { authed } from "../orpc/base";
import { getWorkspace } from "./service";

export const getWorkspaceProcedure = authed.workspace.get.handler(async ({ context }) =>
  getWorkspace(context.database, context.workspace),
);

import { adminRequestProcedure } from "../admin/router";
import { createContactProcedure, listContactsProcedure } from "../contacts/router";
import { getWorkspaceProcedure } from "../workspaces/router";
import { os } from "./base";

export type { OrpcContext, OrpcInitialContext } from "./context";

export const orpcRouter = os.router({
  admin: {
    request: adminRequestProcedure,
  },
  workspace: {
    get: getWorkspaceProcedure,
  },
  contacts: {
    list: listContactsProcedure,
    create: createContactProcedure,
  },
});

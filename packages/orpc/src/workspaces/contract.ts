import { oc } from "@orpc/contract";

import { workspaceErrors } from "../shared/errors";
import { workspaceSchema } from "./schema";

export const workspaceContract = {
  get: oc
    .route({ method: "GET", path: "/workspace" })
    .errors(workspaceErrors)
    .output(workspaceSchema),
};

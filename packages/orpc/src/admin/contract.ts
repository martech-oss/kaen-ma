import { oc } from "@orpc/contract";

import { workspaceErrors } from "../shared/errors";
import { adminRequestInputSchema, adminRequestOutputSchema } from "./schema";

export const adminContract = {
  request: oc
    .route({ method: "POST", path: "/admin/request" })
    .errors(workspaceErrors)
    .input(adminRequestInputSchema)
    .output(adminRequestOutputSchema),
};

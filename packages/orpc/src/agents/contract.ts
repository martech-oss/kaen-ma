import { agentConversationSchema, agentKeySchema } from "@openengage/core/agents";
import { oc } from "@orpc/contract";
import * as z from "zod";

import { workspaceErrors } from "../shared/errors";

export const agentConversationsContract = {
  create: oc
    .route({ method: "POST", path: "/agent-conversations", successStatus: 201 })
    .errors(workspaceErrors)
    .input(z.object({ agent: agentKeySchema }))
    .output(agentConversationSchema),
  list: oc
    .route({ method: "GET", path: "/agent-conversations" })
    .errors(workspaceErrors)
    .input(z.object({ agent: agentKeySchema.optional() }).optional())
    .output(z.array(agentConversationSchema)),
};

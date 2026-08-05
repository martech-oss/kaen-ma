import { AgentConversationRepository } from "@openengage/database";

import { sessionAuthed } from "../orpc/base";

export const createAgentConversationProcedure = sessionAuthed.agentConversations.create.handler(
  async ({ context, input }) =>
    new AgentConversationRepository(context.database).create({
      workspaceId: context.workspace.workspaceId,
      ownerUserId: context.workspace.userId,
      agentKey: input.agent,
    }),
);

export const listAgentConversationsProcedure = sessionAuthed.agentConversations.list.handler(
  async ({ context, input }) =>
    new AgentConversationRepository(context.database).list({
      workspaceId: context.workspace.workspaceId,
      ownerUserId: context.workspace.userId,
      ...(input?.agent ? { agentKey: input.agent } : {}),
    }),
);

import { AgentConversationRepository, resolveMemberContext } from "@openengage/database";
import type { AgentKey, WorkspaceRole } from "@openengage/orpc";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { RuntimeEnv } from "../env";

export type AgentConversationContextResult =
  | {
      ok: true;
      context: {
        conversationId: string;
        workspaceId: string;
        userId: string;
        role: WorkspaceRole;
      };
    }
  | { ok: false; code: "not_found" | "membership_revoked" };

export class AgentBackend extends WorkerEntrypoint<RuntimeEnv> {
  public async resolveConversationContext(
    conversationId: string,
    agentKey: AgentKey,
  ): Promise<AgentConversationContextResult> {
    if (agentKey !== "hello") return { ok: false, code: "not_found" };
    const conversation = await new AgentConversationRepository(this.env.DB).findOwner(
      conversationId,
      agentKey,
    );
    if (!conversation) return { ok: false, code: "not_found" };
    const workspace = await resolveMemberContext(
      this.env.DB,
      conversation.ownerUserId,
      conversation.workspaceId,
    );
    if (!workspace || workspace.workspaceId !== conversation.workspaceId) {
      return { ok: false, code: "membership_revoked" };
    }
    return {
      ok: true,
      context: {
        conversationId,
        workspaceId: workspace.workspaceId,
        userId: workspace.userId,
        role: workspace.role,
      },
    };
  }
}

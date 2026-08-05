import type { AgentKey } from "@openengage/orpc";
import { env } from "cloudflare:workers";

export function resolveConversationContext(conversationId: string, agentKey: AgentKey) {
  const server = env.SERVER_AGENT_API;
  if (!server) throw new Error("SERVER_AGENT_API binding is unavailable");
  return server.resolveConversationContext(conversationId, agentKey);
}

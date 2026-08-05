import * as z from "zod";

export const AGENT_KEYS = ["hello"] as const;
export const agentKeySchema = z.enum(AGENT_KEYS);
export type AgentKey = z.infer<typeof agentKeySchema>;

export const agentConversationSchema = z.object({
  id: z.string(),
  agent: agentKeySchema,
  createdAt: z.string(),
});
export type AgentConversation = z.infer<typeof agentConversationSchema>;

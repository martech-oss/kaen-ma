import type { AgentConversation, AgentKey } from "@openengage/core/agents";
import { and, desc, eq } from "drizzle-orm";

import { createDatabase, type DatabaseSource } from "../client";
import { uuidv7 } from "../shared/uuid";
import { agentConversations } from "./schema";

export interface AgentConversationOwner {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  agentKey: AgentKey;
  createdAt: string;
}

export class AgentConversationRepository {
  public constructor(private readonly database: DatabaseSource) {}

  public async create(input: {
    workspaceId: string;
    ownerUserId: string;
    agentKey: AgentKey;
  }): Promise<AgentConversation> {
    const row = {
      id: uuidv7(),
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      agentKey: input.agentKey,
      createdAt: new Date().toISOString(),
    };
    await createDatabase(this.database).orm.insert(agentConversations).values(row);
    return { id: row.id, agent: row.agentKey, createdAt: row.createdAt };
  }

  public async list(input: {
    workspaceId: string;
    ownerUserId: string;
    agentKey?: AgentKey;
  }): Promise<AgentConversation[]> {
    const conditions = [
      eq(agentConversations.workspaceId, input.workspaceId),
      eq(agentConversations.ownerUserId, input.ownerUserId),
    ];
    if (input.agentKey) conditions.push(eq(agentConversations.agentKey, input.agentKey));
    const rows = await createDatabase(this.database)
      .orm.select({
        id: agentConversations.id,
        agentKey: agentConversations.agentKey,
        createdAt: agentConversations.createdAt,
      })
      .from(agentConversations)
      .where(and(...conditions))
      .orderBy(desc(agentConversations.createdAt));
    return rows.flatMap((row) =>
      isAgentKey(row.agentKey)
        ? [{ id: row.id, agent: row.agentKey, createdAt: row.createdAt }]
        : [],
    );
  }

  public async findOwner(
    conversationId: string,
    agentKey: AgentKey,
  ): Promise<AgentConversationOwner | null> {
    const [row] = await createDatabase(this.database)
      .orm.select()
      .from(agentConversations)
      .where(
        and(eq(agentConversations.id, conversationId), eq(agentConversations.agentKey, agentKey)),
      )
      .limit(1);
    return row && isAgentKey(row.agentKey) ? { ...row, agentKey: row.agentKey } : null;
  }
}

function isAgentKey(value: string): value is AgentKey {
  return value === "hello";
}

import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization, user } from "../auth/schema";

export const agentConversations = sqliteTable(
  "agent_conversations",
  {
    id: text().primaryKey().notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("agent_conversations_owner_created_idx").on(
      table.workspaceId,
      table.ownerUserId,
      table.createdAt,
    ),
  ],
);

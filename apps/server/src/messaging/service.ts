import type {
  EmailSegmentOption,
  MessageVariable,
  MessageVariableWrite,
  SubscriptionTopicOption,
} from "@openengage/core/messaging";
import {
  ConsentRepository,
  MessagingRepository,
  SegmentRepository,
  type OpenEngageDatabase,
} from "@openengage/database";
import type { WorkspaceContext } from "@openengage/orpc";

export * from "./template-service";

export function listMessageVariables(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<MessageVariable[]> {
  return new MessagingRepository(database, workspace).listMessageVariables(archived);
}

export class VariableConflictError extends Error {
  public override readonly name = "VariableConflictError";
}

export async function createMessageVariable(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  input: MessageVariableWrite,
): Promise<{ id: string }> {
  try {
    return await new MessagingRepository(database, workspace).createMessageVariable(input);
  } catch {
    throw new VariableConflictError();
  }
}

export async function updateMessageVariable(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: MessageVariableWrite,
): Promise<boolean> {
  try {
    return await new MessagingRepository(database, workspace).updateMessageVariable(id, input);
  } catch {
    throw new VariableConflictError();
  }
}

export function archiveMessageVariable(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).archiveMessageVariable(id);
}

export async function listEmailSegmentOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<EmailSegmentOption[]> {
  const rows = await new SegmentRepository(database, workspace).listSegments();
  return rows.map((row) => ({ id: row.id, name: row.name, memberCount: row.memberCount }));
}

export async function listSubscriptionTopicOptions(
  database: OpenEngageDatabase,
  workspace: WorkspaceContext,
): Promise<SubscriptionTopicOption[]> {
  const rows = await new ConsentRepository(database, workspace).listTopics();
  return rows.map((row) => ({ id: row.id, name: row.name, isDefault: row.isDefault }));
}

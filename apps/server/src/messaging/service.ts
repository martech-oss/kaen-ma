import {
  BroadcastRepository,
  ConsentRepository,
  MessagingRepository,
  SegmentRepository,
  type BroadcastCampaignRecord,
  type KaenmaDatabase,
} from "@kaenma/database";
import type { WorkspaceContext } from "@kaenma/orpc";
import type {
  BroadcastSegmentOption,
  BroadcastStatus,
  BroadcastWrite,
  EmailCampaign,
  MessageVariable,
  MessageVariableWrite,
  SubscriptionTopicOption,
} from "@kaenma/orpc";

import type { RuntimeEnv } from "../env";

export function hasValidBroadcastResources(
  database: KaenmaDatabase,
  workspaceId: string,
  segmentId: string,
  templateId: string,
): Promise<boolean> {
  return new BroadcastRepository(database, { workspaceId }).hasValidBroadcastResources(
    segmentId,
    templateId,
  );
}

export * from "./template-service";

function toEmailCampaign(row: BroadcastCampaignRecord): EmailCampaign {
  // The broadcasts status check constraint restricts the column to the enum.
  return { ...row, status: row.status as BroadcastStatus };
}

export async function listEmailCampaigns(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<EmailCampaign[]> {
  const rows = await new BroadcastRepository(database, workspace).listBroadcasts(archived);
  return rows.map(toEmailCampaign);
}

export async function getEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  broadcastId: string,
): Promise<EmailCampaign | null> {
  const row = await new BroadcastRepository(database, workspace).getBroadcast(broadcastId);
  return row ? toEmailCampaign(row) : null;
}

/** Create can only fail on resources; update can also find nothing editable. */
export type BroadcastCreateOutcome =
  | { kind: "invalid_resources" }
  | { kind: "created"; id: string };
export type BroadcastUpdateOutcome =
  | { kind: "invalid_resources" }
  | { kind: "not_editable" }
  | { kind: "updated" };

export async function createEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: BroadcastWrite,
): Promise<BroadcastCreateOutcome> {
  const repository = new BroadcastRepository(database, workspace);
  if (!(await repository.hasValidBroadcastResources(input.segmentId, input.templateId))) {
    return { kind: "invalid_resources" };
  }
  const { id } = await repository.createBroadcast({
    name: input.name,
    segmentId: input.segmentId,
    templateId: input.templateId,
    topicId: input.topicId ?? null,
    status: input.scheduledAt ? "scheduled" : "draft",
    scheduledAt: input.scheduledAt ?? null,
  });
  return { kind: "created", id };
}

export async function updateEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
  input: BroadcastWrite,
): Promise<BroadcastUpdateOutcome> {
  const repository = new BroadcastRepository(database, workspace);
  if (!(await repository.hasValidBroadcastResources(input.segmentId, input.templateId))) {
    return { kind: "invalid_resources" };
  }
  const updated = await repository.updateBroadcast(id, {
    name: input.name,
    segmentId: input.segmentId,
    templateId: input.templateId,
    topicId: input.topicId ?? null,
    status: input.scheduledAt ? "scheduled" : "draft",
    scheduledAt: input.scheduledAt ?? null,
  });
  return updated ? { kind: "updated" } : { kind: "not_editable" };
}

/** Flips the broadcast to sending and enqueues the first batch. */
export async function startEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  env: RuntimeEnv,
  id: string,
): Promise<"ok" | "not_configured" | "not_startable"> {
  if (!env.RESEND_SEND_API_KEY) return "not_configured";
  if (!(await new BroadcastRepository(database, workspace).startBroadcast(id))) {
    return "not_startable";
  }
  await env.CAMPAIGN_QUEUE.send({ kind: "broadcast_batch", broadcastId: id });
  return "ok";
}

export function archiveEmailCampaign(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new BroadcastRepository(database, workspace).archiveBroadcast(id);
}

export function listMessageVariables(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  archived: boolean,
): Promise<MessageVariable[]> {
  return new MessagingRepository(database, workspace).listMessageVariables(archived);
}

export class VariableConflictError extends Error {
  public override readonly name = "VariableConflictError";
}

export async function createMessageVariable(
  database: KaenmaDatabase,
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
  database: KaenmaDatabase,
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
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return new MessagingRepository(database, workspace).archiveMessageVariable(id);
}

export async function listBroadcastSegmentOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<BroadcastSegmentOption[]> {
  const rows = await new SegmentRepository(database, workspace).listSegments();
  return rows.map((row) => ({ id: row.id, name: row.name, memberCount: row.memberCount }));
}

export async function listSubscriptionTopicOptions(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
): Promise<SubscriptionTopicOption[]> {
  const rows = await new ConsentRepository(database, workspace).listTopics();
  return rows.map((row) => ({ id: row.id, name: row.name, isDefault: row.isDefault }));
}

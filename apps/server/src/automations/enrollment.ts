import {
  CampaignEngineRepository,
  CampaignRepository,
  type KaenmaDatabase,
} from "@kaenma/database";
import type { CampaignDefinition } from "@kaenma/orpc";

export interface ContactEvent {
  id: string;
  workspaceId: string;
  contactId: string;
  type: string;
  resourceId?: string | null;
}

interface CampaignTriggerRef {
  campaignVersionId: string;
  campaignId: string;
  sourceNodeId: string;
  reentry: string;
}

export interface EnrollmentResult {
  enrollmentId: string;
  jobId: string;
}

export async function enrollAutomationsForEvent(
  database: KaenmaDatabase,
  event: ContactEvent,
): Promise<EnrollmentResult[]> {
  const repository = new CampaignRepository(database, { workspaceId: event.workspaceId });
  const triggers = await repository.listActiveTriggersForEvent(
    event.type,
    event.resourceId ?? null,
  );

  const enrollments: EnrollmentResult[] = [];
  for (const trigger of triggers) {
    const result = await enrollFromTrigger(repository, trigger, {
      contactId: event.contactId,
      sourceEventId: event.id,
    });
    if (result) enrollments.push(result);
  }
  return enrollments;
}

export async function enrollInactiveContacts(
  database: KaenmaDatabase,
  now = new Date(),
  limit = 200,
): Promise<number> {
  const engine = new CampaignEngineRepository(database);
  const candidates = await engine.listInactiveEnrollmentCandidates(now.toISOString(), limit);

  let enrolled = 0;
  for (const candidate of candidates) {
    const repository = new CampaignRepository(database, { workspaceId: candidate.workspaceId });
    const result = await enrollFromTrigger(repository, candidate, {
      contactId: candidate.contactId,
      sourceEventId: `inactive:${candidate.campaignVersionId}:${candidate.contactId}`,
    });
    if (result) enrolled += 1;
  }
  return enrolled;
}

export type ManualEnrollOutcome =
  | { kind: "not_active" }
  | { kind: "source_missing" }
  | { kind: "already_enrolled" }
  | { kind: "enrolled"; result: EnrollmentResult };

/** API/SDK-driven enrollment of one contact into the published version. */
export async function enrollContactManually(
  database: KaenmaDatabase,
  input: {
    workspaceId: string;
    campaignId: string;
    contactId: string;
    sourceEventId: string;
  },
): Promise<ManualEnrollOutcome> {
  const repository = new CampaignRepository(database, { workspaceId: input.workspaceId });
  const campaign = await repository.findActivePublishedCampaign(input.campaignId);
  if (!campaign) return { kind: "not_active" };
  const graph = JSON.parse(campaign.graph) as CampaignDefinition;
  const source = graph.nodes.find((node) => node.type === "source");
  if (!source) return { kind: "source_missing" };
  const result = await enrollPublishedCampaign(database, {
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    campaignVersionId: campaign.publishedVersionId,
    contactId: input.contactId,
    sourceNodeId: source.id,
    sourceEventId: input.sourceEventId,
  });
  if (!result) return { kind: "already_enrolled" };
  return { kind: "enrolled", result };
}

export async function enrollPublishedCampaign(
  database: KaenmaDatabase,
  input: {
    workspaceId: string;
    campaignId: string;
    campaignVersionId: string;
    contactId: string;
    sourceNodeId: string;
    sourceEventId: string;
    reentry?: "once" | "every_time";
  },
): Promise<EnrollmentResult | null> {
  return enrollFromTrigger(
    new CampaignRepository(database, { workspaceId: input.workspaceId }),
    {
      campaignId: input.campaignId,
      campaignVersionId: input.campaignVersionId,
      sourceNodeId: input.sourceNodeId,
      reentry: input.reentry ?? "every_time",
    },
    {
      contactId: input.contactId,
      sourceEventId: input.sourceEventId,
    },
  );
}

async function enrollFromTrigger(
  repository: CampaignRepository,
  trigger: CampaignTriggerRef,
  input: {
    contactId: string;
    sourceEventId: string;
  },
): Promise<EnrollmentResult | null> {
  // "once" re-entry is enforced by storing the sentinel string "once" as the
  // source event id, which trips the enrollment unique index on any repeat.
  const sourceEventId = trigger.reentry === "once" ? "once" : input.sourceEventId;
  return repository.enrollContact({
    campaignId: trigger.campaignId,
    campaignVersionId: trigger.campaignVersionId,
    sourceNodeId: trigger.sourceNodeId,
    contactId: input.contactId,
    sourceEventId,
  });
}

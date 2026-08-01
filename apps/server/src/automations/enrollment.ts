import { type KaenmaDatabase, uuidv7 } from "@kaenma/database";
import type { CampaignDefinition } from "@kaenma/orpc";

export interface ContactEvent {
  id: string;
  workspaceId: string;
  contactId: string;
  type: string;
  resourceId?: string | null;
}

interface CampaignTriggerRow {
  campaign_version_id: string;
  campaign_id: string;
  source_node_id: string;
  reentry: "once" | "every_time";
}

export interface EnrollmentResult {
  enrollmentId: string;
  jobId: string;
}

export async function enrollAutomationsForEvent(
  database: KaenmaDatabase,
  event: ContactEvent,
): Promise<EnrollmentResult[]> {
  const triggers = await database
    .prepare(
      `SELECT ct.campaign_version_id, ct.campaign_id, ct.source_node_id, ct.reentry
       FROM campaign_triggers ct
       JOIN campaigns c
         ON c.workspace_id = ct.workspace_id AND c.id = ct.campaign_id
       WHERE ct.workspace_id = ?
         AND c.status = 'active'
         AND c.published_version_id = ct.campaign_version_id
         AND ct.event_type = ?
         AND (ct.resource_id IS NULL OR ct.resource_id = ?)`,
    )
    .bind(event.workspaceId, event.type, event.resourceId ?? null)
    .all<CampaignTriggerRow>();

  const enrollments: EnrollmentResult[] = [];
  for (const trigger of triggers.results) {
    const result = await enrollFromTrigger(database, trigger, {
      workspaceId: event.workspaceId,
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
  const candidates = await database
    .prepare(
      `SELECT ct.campaign_version_id, ct.campaign_id, ct.source_node_id, ct.reentry,
              c.workspace_id, c.id AS contact_id
       FROM campaign_triggers ct
       JOIN campaigns campaign
         ON campaign.workspace_id = ct.workspace_id AND campaign.id = ct.campaign_id
       JOIN contacts c ON c.workspace_id = ct.workspace_id
       WHERE ct.source = 'contact_inactive'
         AND campaign.status = 'active'
         AND campaign.published_version_id = ct.campaign_version_id
         AND c.status = 'active'
         AND julianday(COALESCE((
           SELECT MAX(ce.occurred_at)
           FROM contact_events ce
           WHERE ce.workspace_id = c.workspace_id AND ce.contact_id = c.id
         ), c.created_at)) <= julianday(?) - ct.inactivity_days
         AND NOT EXISTS (
           SELECT 1 FROM campaign_enrollments enrollment
           WHERE enrollment.workspace_id = ct.workspace_id
             AND enrollment.campaign_id = ct.campaign_id
             AND enrollment.contact_id = c.id
             AND enrollment.source_event_id = 'once'
         )
       ORDER BY c.updated_at ASC
       LIMIT ?`,
    )
    .bind(now.toISOString(), limit)
    .all<CampaignTriggerRow & { workspace_id: string; contact_id: string }>();

  let enrolled = 0;
  for (const candidate of candidates.results) {
    const result = await enrollFromTrigger(database, candidate, {
      workspaceId: candidate.workspace_id,
      contactId: candidate.contact_id,
      sourceEventId: `inactive:${candidate.campaign_version_id}:${candidate.contact_id}`,
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
  const campaign = await database
    .prepare(
      `SELECT c.published_version_id, cv.graph
       FROM campaigns c JOIN campaign_versions cv
         ON cv.id = c.published_version_id AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status = 'active'`,
    )
    .bind(input.workspaceId, input.campaignId)
    .first<{ published_version_id: string; graph: string }>();
  if (!campaign) return { kind: "not_active" };
  const graph = JSON.parse(campaign.graph) as CampaignDefinition;
  const source = graph.nodes.find((node) => node.type === "source");
  if (!source) return { kind: "source_missing" };
  const result = await enrollPublishedCampaign(database, {
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    campaignVersionId: campaign.published_version_id,
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
    database,
    {
      campaign_id: input.campaignId,
      campaign_version_id: input.campaignVersionId,
      source_node_id: input.sourceNodeId,
      reentry: input.reentry ?? "every_time",
    },
    {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      sourceEventId: input.sourceEventId,
    },
  );
}

async function enrollFromTrigger(
  database: KaenmaDatabase,
  trigger: CampaignTriggerRow,
  input: {
    workspaceId: string;
    contactId: string;
    sourceEventId: string;
  },
): Promise<EnrollmentResult | null> {
  const enrollmentId = uuidv7();
  const jobId = uuidv7();
  const now = new Date().toISOString();
  const sourceEventId = trigger.reentry === "once" ? "once" : input.sourceEventId;
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO campaign_enrollments
           (id, workspace_id, campaign_id, campaign_version_id, contact_id,
            source_event_id, status, current_node_id, entered_at, updated_at)
           SELECT ?, ?, ?, ?, c.id, ?, 'active', ?, ?, ?
           FROM contacts c
           WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived'`,
        )
        .bind(
          enrollmentId,
          input.workspaceId,
          trigger.campaign_id,
          trigger.campaign_version_id,
          sourceEventId,
          trigger.source_node_id,
          now,
          now,
          input.workspaceId,
          input.contactId,
        ),
      database
        .prepare(
          `INSERT INTO campaign_jobs
           (id, workspace_id, enrollment_id, campaign_version_id, node_id,
            recipient_id, idempotency_key, status, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(
          jobId,
          input.workspaceId,
          enrollmentId,
          trigger.campaign_version_id,
          trigger.source_node_id,
          input.contactId,
          `${enrollmentId}:${trigger.source_node_id}:${input.contactId}`,
          now,
          now,
          now,
        ),
    ]);
    return { enrollmentId, jobId };
  } catch (error) {
    if (isConstraintError(error)) return null;
    throw error;
  }
}

function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique|foreign key/i.test(message);
}

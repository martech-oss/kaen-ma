import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { assertJobTransition, type JobStatus } from "@kaenma/core";
import type { WorkspaceContext } from "@kaenma/orpc";

import { createDatabase, type DatabaseSource, type KaenmaDatabase } from "../client";
import { contactEvents, contacts, contactTags, scoreEvents, tags } from "../contacts/schema";
import { emailTemplates } from "../messaging/schema";
import { segmentMemberships } from "../segments/schema";
import { uuidv7 } from "../shared/uuid";
import {
  campaignEnrollments,
  campaignJobs,
  campaigns,
  campaignTriggers,
  campaignVersions,
} from "./schema";

/** campaign_jobs.status vocabulary (mirrors the table CHECK constraint). */
export type CampaignJobStatus =
  | "pending"
  | "leased"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * campaign_jobs speaks an older dialect of the shared job state machine in
 * `@kaenma/core`: `running`/`succeeded` are the machine's
 * `processing`/`completed`.
 */
const MACHINE_STATUS = {
  pending: "pending",
  leased: "leased",
  queued: "queued",
  running: "processing",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<CampaignJobStatus, JobStatus>;

/**
 * Machine hops the table stores no row for. A claimed job is put on the
 * Cloudflare queue without another write, so one `leased -> running` UPDATE
 * traverses `leased -> queued -> processing`; a crashed run goes back to the
 * queue by re-leasing (the queue message is retried), so one
 * `running -> leased` UPDATE traverses `processing -> pending -> leased`.
 */
const COLLAPSED_HOPS: Partial<Record<`${JobStatus}->${JobStatus}`, readonly JobStatus[]>> = {
  "leased->processing": ["queued"],
  "processing->leased": ["pending"],
};

/**
 * Routes a campaign_jobs status write through the shared job state machine.
 * Every hop of the (possibly collapsed) machine path is asserted, so an
 * UPDATE that would skip or reverse the machine throws before touching the
 * database. Writes stay conditional (`WHERE status = expected`) on top of
 * this, preserving the optimistic-concurrency behavior the worker relies on.
 */
function assertCampaignJobTransition(from: CampaignJobStatus, to: CampaignJobStatus): void {
  const source = MACHINE_STATUS[from];
  const target = MACHINE_STATUS[to];
  const path: readonly JobStatus[] = [
    source,
    ...(COLLAPSED_HOPS[`${source}->${target}`] ?? []),
    target,
  ];
  for (let index = 0; index + 1 < path.length; index += 1) {
    assertJobTransition(path[index] as JobStatus, path[index + 1] as JobStatus);
  }
}

/**
 * One executable campaign job joined with the graph, enrollment and contact
 * data the worker needs. Field names are snake_case because this row is the
 * long-standing contract of the automation worker, also consumed by the
 * messaging delivery worker.
 */
export interface CampaignJobRow {
  id: string;
  workspace_id: string;
  enrollment_id: string;
  campaign_version_id: string;
  node_id: string;
  recipient_id: string;
  idempotency_key: string;
  payload: string;
  status: string;
  lease_id: string | null;
  attempts: number;
  created_at: string;
  entered_at: string;
  graph: string;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  stage: string;
  score: number;
  custom_fields: string;
}

/** Contact columns a campaign "update_field" action may write directly. */
const AUTOMATION_CONTACT_COLUMNS = {
  first_name: "firstName",
  last_name: "lastName",
  phone: "phone",
  stage: "stage",
  external_id: "externalId",
} as const;

export type AutomationContactColumn = keyof typeof AUTOMATION_CONTACT_COLUMNS;

/**
 * Worker-side store for the campaign engine. Deliberately unscoped: the
 * dispatcher scans and claims jobs across every workspace, and the queue
 * consumer locates a job by (id, lease id) alone — the workspace always comes
 * from the claimed row itself, never from a session.
 *
 * Contact/tag/segment mutations here implement campaign-action semantics
 * (no archived-contact guard, membership source 'campaign'), which is why
 * they exist alongside the stricter ContactResourceRepository methods.
 */
export class CampaignEngineRepository {
  private readonly database: KaenmaDatabase;

  public constructor(database: DatabaseSource) {
    this.database = createDatabase(database);
  }

  /** Workspaces holding due pending jobs, oldest due first (dispatch fan-out). */
  public async workspacesWithDueJobs(
    now: string,
    limit = 50,
  ): Promise<Array<{ workspaceId: string }>> {
    const oldest = sql<string>`MIN(${campaignJobs.dueAt})`.as("oldest");
    const rows = await this.database.orm
      .select({ workspaceId: campaignJobs.workspaceId, oldest })
      .from(campaignJobs)
      .where(and(eq(campaignJobs.status, "pending"), lte(campaignJobs.dueAt, now)))
      .groupBy(campaignJobs.workspaceId)
      .orderBy(asc(sql`oldest`))
      .limit(limit);
    return rows.map((row) => ({ workspaceId: row.workspaceId }));
  }

  /**
   * Leases due pending jobs (pending -> leased). The lease UPDATE re-checks
   * `status = 'pending'` and the lease expiry, so concurrent dispatchers can
   * race on the same candidates and only the winner of each row keeps it.
   */
  public async claimDueJobs(
    now: string,
    leaseUntil: string,
    limit = 100,
    workspaceId?: string,
  ): Promise<Array<{ id: string; leaseId: string }>> {
    const orm = this.database.orm;
    const conditions = [
      eq(campaignJobs.status, "pending"),
      lte(campaignJobs.dueAt, now),
      or(isNull(campaignJobs.leaseUntil), lt(campaignJobs.leaseUntil, now))!,
    ];
    if (workspaceId) conditions.push(eq(campaignJobs.workspaceId, workspaceId));
    const candidates = await orm
      .select({ id: campaignJobs.id })
      .from(campaignJobs)
      .where(and(...conditions))
      .orderBy(asc(campaignJobs.dueAt))
      .limit(limit);
    const claims = candidates.map((candidate) => ({ id: candidate.id, leaseId: uuidv7() }));
    const [first, ...rest] = claims.map((claim) =>
      orm
        .update(campaignJobs)
        .set({ status: "leased", leaseId: claim.leaseId, leaseUntil, updatedAt: now })
        .where(
          and(
            eq(campaignJobs.id, claim.id),
            eq(campaignJobs.status, "pending"),
            or(isNull(campaignJobs.leaseUntil), lt(campaignJobs.leaseUntil, now)),
          ),
        ),
    );
    if (!first) return [];
    assertCampaignJobTransition("pending", "leased");
    const results = await orm.batch([first, ...rest]);
    return claims.filter((_, index) => results[index]?.meta.changes === 1);
  }

  /** Loads a leased/running job with its graph, enrollment and contact row. */
  public async findJobForProcessing(
    jobId: string,
    leaseId: string,
  ): Promise<CampaignJobRow | null> {
    const row = await this.database.orm
      .select({
        id: campaignJobs.id,
        workspace_id: campaignJobs.workspaceId,
        enrollment_id: campaignJobs.enrollmentId,
        campaign_version_id: campaignJobs.campaignVersionId,
        node_id: campaignJobs.nodeId,
        recipient_id: campaignJobs.recipientId,
        idempotency_key: campaignJobs.idempotencyKey,
        payload: campaignJobs.payload,
        status: campaignJobs.status,
        lease_id: campaignJobs.leaseId,
        attempts: campaignJobs.attempts,
        created_at: campaignJobs.createdAt,
        entered_at: campaignEnrollments.enteredAt,
        graph: campaignVersions.graph,
        contact_email: contacts.email,
        first_name: contacts.firstName,
        last_name: contacts.lastName,
        phone: contacts.phone,
        stage: contacts.stage,
        score: contacts.score,
        custom_fields: contacts.customFields,
      })
      .from(campaignJobs)
      .innerJoin(
        campaignVersions,
        and(
          eq(campaignVersions.id, campaignJobs.campaignVersionId),
          eq(campaignVersions.workspaceId, campaignJobs.workspaceId),
        ),
      )
      .innerJoin(
        campaignEnrollments,
        and(
          eq(campaignEnrollments.id, campaignJobs.enrollmentId),
          eq(campaignEnrollments.workspaceId, campaignJobs.workspaceId),
        ),
      )
      .innerJoin(
        contacts,
        and(
          eq(contacts.id, campaignJobs.recipientId),
          eq(contacts.workspaceId, campaignJobs.workspaceId),
        ),
      )
      .where(
        and(
          eq(campaignJobs.id, jobId),
          eq(campaignJobs.leaseId, leaseId),
          inArray(campaignJobs.status, ["leased", "running"]),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Marks a leased job running and counts the attempt (leased -> running).
   * Returns false when the row was not in 'leased' anymore — the caller then
   * decides whether it already owns a running row.
   */
  public async startLeasedJob(jobId: string, leaseId: string, now: string): Promise<boolean> {
    assertCampaignJobTransition("leased", "running");
    const result = await this.database.orm
      .update(campaignJobs)
      .set({ status: "running", attempts: sql`${campaignJobs.attempts} + 1`, updatedAt: now })
      .where(
        and(
          eq(campaignJobs.id, jobId),
          eq(campaignJobs.leaseId, leaseId),
          eq(campaignJobs.status, "leased"),
        ),
      );
    return result.meta.changes > 0;
  }

  /** Re-schedules a running job to wake at `dueAt` (running -> pending). */
  public async parkJobUntil(
    jobId: string,
    leaseId: string,
    input: { dueAt: string; payload: string; now: string },
  ): Promise<void> {
    assertCampaignJobTransition("running", "pending");
    await this.database.orm
      .update(campaignJobs)
      .set({
        status: "pending",
        dueAt: input.dueAt,
        payload: input.payload,
        leaseId: null,
        leaseUntil: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(campaignJobs.id, jobId),
          eq(campaignJobs.leaseId, leaseId),
          eq(campaignJobs.status, "running"),
        ),
      );
  }

  /**
   * Records the failure and hands the running job back to the queue retry
   * (running -> leased); the lease is kept so the retried message can resume.
   */
  public async releaseJobForRetry(
    jobId: string,
    leaseId: string,
    lastError: string,
    now: string,
  ): Promise<void> {
    assertCampaignJobTransition("running", "leased");
    await this.database.orm
      .update(campaignJobs)
      .set({ status: "leased", lastError, updatedAt: now })
      .where(
        and(
          eq(campaignJobs.id, jobId),
          eq(campaignJobs.leaseId, leaseId),
          eq(campaignJobs.status, "running"),
        ),
      );
  }

  /**
   * Terminal node: succeeds the job and completes the enrollment in one
   * atomic batch (running -> succeeded). The job UPDATE matches on the lease
   * alone — the holder finishes its row regardless of status races.
   */
  public async completeJobClosingEnrollment(
    job: Pick<CampaignJobRow, "id" | "workspace_id" | "enrollment_id">,
    leaseId: string,
    now: string,
  ): Promise<void> {
    assertCampaignJobTransition("running", "succeeded");
    const orm = this.database.orm;
    await orm.batch([
      this.jobSucceededUpdate(job.id, leaseId, now),
      orm
        .update(campaignEnrollments)
        .set({ status: "completed", currentNodeId: null, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(campaignEnrollments.workspaceId, job.workspace_id),
            eq(campaignEnrollments.id, job.enrollment_id),
          ),
        ),
    ]);
  }

  /**
   * Succeeds the job, inserts the follow-up job for the next node and moves
   * the enrollment cursor, atomically (running -> succeeded; the new job is
   * born 'pending'). The insert dedupes on the idempotency key so a replayed
   * completion never doubles the next step.
   */
  public async completeJobAdvancingEnrollment(
    job: Pick<
      CampaignJobRow,
      "id" | "workspace_id" | "enrollment_id" | "campaign_version_id" | "recipient_id"
    >,
    leaseId: string,
    nextNodeId: string,
    now: string,
  ): Promise<void> {
    assertCampaignJobTransition("running", "succeeded");
    const orm = this.database.orm;
    await orm.batch([
      this.jobSucceededUpdate(job.id, leaseId, now),
      orm
        .insert(campaignJobs)
        .values({
          id: uuidv7(),
          workspaceId: job.workspace_id,
          enrollmentId: job.enrollment_id,
          campaignVersionId: job.campaign_version_id,
          nodeId: nextNodeId,
          recipientId: job.recipient_id,
          idempotencyKey: `${job.enrollment_id}:${nextNodeId}:${job.recipient_id}`,
          status: "pending",
          dueAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      orm
        .update(campaignEnrollments)
        .set({ currentNodeId: nextNodeId, updatedAt: now })
        .where(
          and(
            eq(campaignEnrollments.workspaceId, job.workspace_id),
            eq(campaignEnrollments.id, job.enrollment_id),
            eq(campaignEnrollments.status, "active"),
          ),
        ),
    ]);
  }

  /** Decision nodes: has the contact produced this event since enrollment? */
  public async hasContactEventSince(
    workspaceId: string,
    contactId: string,
    type: string,
    since: string,
    resourceId: string | null,
  ): Promise<boolean> {
    const conditions = [
      eq(contactEvents.workspaceId, workspaceId),
      eq(contactEvents.contactId, contactId),
      eq(contactEvents.type, type),
      gte(contactEvents.occurredAt, since),
    ];
    if (resourceId !== null) conditions.push(eq(contactEvents.resourceId, resourceId));
    const row = await this.database.orm
      .select({ id: contactEvents.id })
      .from(contactEvents)
      .where(and(...conditions))
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** Condition nodes: does the contact carry a tag with this slug? */
  public async contactHasTagWithSlug(
    workspaceId: string,
    contactId: string,
    slug: string,
  ): Promise<boolean> {
    const row = await this.database.orm
      .select({ value: sql`1` })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(
        and(
          eq(contactTags.workspaceId, workspaceId),
          eq(contactTags.contactId, contactId),
          eq(tags.slug, slug),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }

  /** add_tag action: links the tag, keeping an existing link as-is. */
  public async addContactTag(
    workspaceId: string,
    contactId: string,
    tagId: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .insert(contactTags)
      .values({ workspaceId, contactId, tagId, createdAt: now })
      .onConflictDoNothing();
  }

  /** remove_tag action: unlinks the tag. */
  public async removeContactTag(
    workspaceId: string,
    contactId: string,
    tagId: string,
  ): Promise<void> {
    await this.database.orm
      .delete(contactTags)
      .where(
        and(
          eq(contactTags.workspaceId, workspaceId),
          eq(contactTags.contactId, contactId),
          eq(contactTags.tagId, tagId),
        ),
      );
  }

  /**
   * add_segment action: joins the contact with source 'campaign'. Returns
   * whether a row was written, so the caller can emit `segment_joined` only
   * on a fresh membership.
   */
  public async addCampaignSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(segmentMemberships)
      .values({ workspaceId, segmentId, contactId, source: "campaign", joinedAt: now })
      .onConflictDoNothing();
    return result.meta.changes === 1;
  }

  /** remove_segment action: removes the membership regardless of its source. */
  public async removeSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
  ): Promise<void> {
    await this.database.orm
      .delete(segmentMemberships)
      .where(
        and(
          eq(segmentMemberships.workspaceId, workspaceId),
          eq(segmentMemberships.segmentId, segmentId),
          eq(segmentMemberships.contactId, contactId),
        ),
      );
  }

  /**
   * change_score action: applies the delta and records the score event
   * against the enrollment, atomically.
   */
  public async adjustContactScoreForEnrollment(
    workspaceId: string,
    contactId: string,
    enrollmentId: string,
    amount: number,
    now: string,
  ): Promise<void> {
    const orm = this.database.orm;
    const current = await orm
      .select({ score: contacts.score })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
      .get();
    const total = (current?.score ?? 0) + amount;
    await orm.batch([
      orm
        .update(contacts)
        .set({ score: total, updatedAt: now })
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))),
      orm.insert(scoreEvents).values({
        id: uuidv7(),
        workspaceId,
        contactId,
        delta: amount,
        total,
        reason: "campaign",
        campaignEnrollmentId: enrollmentId,
        createdAt: now,
      }),
    ]);
  }

  /** update_field action targeting one of the known contact columns. */
  public async updateContactColumn(
    workspaceId: string,
    contactId: string,
    column: AutomationContactColumn,
    value: string,
    now: string,
  ): Promise<void> {
    const assignments: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      stage?: string;
      externalId?: string;
      updatedAt: string;
    } = { updatedAt: now };
    assignments[AUTOMATION_CONTACT_COLUMNS[column]] = value;
    await this.database.orm
      .update(contacts)
      .set(assignments)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }

  /** update_field action targeting a custom field: stores the merged JSON. */
  public async replaceContactCustomFields(
    workspaceId: string,
    contactId: string,
    customFields: string,
    now: string,
  ): Promise<void> {
    await this.database.orm
      .update(contacts)
      .set({ customFields, updatedAt: now })
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)));
  }

  /**
   * Cross-workspace scan for 'contact_inactive' triggers: active contacts of
   * active campaigns whose latest event (or creation) is at least
   * `inactivity_days` before `now`, excluding contacts already enrolled via
   * the "once" sentinel.
   */
  public async listInactiveEnrollmentCandidates(
    now: string,
    limit: number,
  ): Promise<
    Array<{
      campaignVersionId: string;
      campaignId: string;
      sourceNodeId: string;
      reentry: string;
      workspaceId: string;
      contactId: string;
    }>
  > {
    const orm = this.database.orm;
    return await orm
      .select({
        campaignVersionId: campaignTriggers.campaignVersionId,
        campaignId: campaignTriggers.campaignId,
        sourceNodeId: campaignTriggers.sourceNodeId,
        reentry: campaignTriggers.reentry,
        workspaceId: contacts.workspaceId,
        contactId: contacts.id,
      })
      .from(campaignTriggers)
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.workspaceId, campaignTriggers.workspaceId),
          eq(campaigns.id, campaignTriggers.campaignId),
        ),
      )
      .innerJoin(contacts, eq(contacts.workspaceId, campaignTriggers.workspaceId))
      .where(
        and(
          eq(campaignTriggers.source, "contact_inactive"),
          eq(campaigns.status, "active"),
          eq(campaigns.publishedVersionId, campaignTriggers.campaignVersionId),
          eq(contacts.status, "active"),
          sql`julianday(COALESCE((
            SELECT MAX(${contactEvents.occurredAt}) FROM ${contactEvents}
            WHERE ${contactEvents.workspaceId} = ${contacts.workspaceId}
              AND ${contactEvents.contactId} = ${contacts.id}
          ), ${contacts.createdAt})) <= julianday(${now}) - ${campaignTriggers.inactivityDays}`,
          notExists(
            orm
              .select({ value: sql`1` })
              .from(campaignEnrollments)
              .where(
                and(
                  eq(campaignEnrollments.workspaceId, campaignTriggers.workspaceId),
                  eq(campaignEnrollments.campaignId, campaignTriggers.campaignId),
                  eq(campaignEnrollments.contactId, contacts.id),
                  eq(campaignEnrollments.sourceEventId, "once"),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(contacts.updatedAt))
      .limit(limit);
  }

  /** Succeeds a finished job; matches on the lease only, like the worker always has. */
  private jobSucceededUpdate(jobId: string, leaseId: string, now: string) {
    return this.database.orm
      .update(campaignJobs)
      .set({ status: "succeeded", leaseId: null, leaseUntil: null, updatedAt: now })
      .where(and(eq(campaignJobs.id, jobId), eq(campaignJobs.leaseId, leaseId)));
  }
}

/**
 * Legacy free-function entry point for the dispatcher; claims due pending
 * jobs across (or within) workspaces. Delegates to
 * {@link CampaignEngineRepository.claimDueJobs}.
 */
export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  return new CampaignEngineRepository(database).claimDueJobs(now, leaseUntil, limit, workspaceId);
}

/**
 * Workspace-scoped campaign store: admin CRUD, the publish pipeline and
 * enrollment writes. Scoped by workspace id only, because event-driven
 * enrollment flows resolve just the workspace id; a full
 * {@link WorkspaceContext} is assignable wherever this scope is expected.
 */
export class CampaignRepository {
  private readonly database: KaenmaDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
  ) {
    this.database = createDatabase(database);
  }

  /** Campaign list rows with enrollment counters and the published trigger source. */
  public async listCampaignsWithCounts(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      status: string;
      triggerSource: string | null;
      enrollmentCount: number;
      activeCount: number;
      completedCount: number;
      updatedAt: string;
    }>
  > {
    // Correlated subqueries are embedded as builders: interpolating a plain
    // `${table.column}` into a select field renders it unqualified, which
    // would silently self-compare inside the subquery.
    const triggerSourceQuery = this.database.orm
      .select({ source: campaignTriggers.source })
      .from(campaignTriggers)
      .where(
        and(
          eq(campaignTriggers.workspaceId, campaigns.workspaceId),
          eq(campaignTriggers.campaignVersionId, campaigns.publishedVersionId),
        ),
      );
    return await this.database.orm
      .select({
        id: campaigns.id,
        name: campaigns.name,
        description: campaigns.description,
        status: campaigns.status,
        triggerSource: sql<string | null>`${triggerSourceQuery}`.as("trigger_source"),
        enrollmentCount: this.enrollmentCountExpression().as("enrollment_count"),
        activeCount: this.enrollmentCountExpression("active").as("active_count"),
        completedCount: this.enrollmentCountExpression("completed").as("completed_count"),
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .where(eq(campaigns.workspaceId, this.context.workspaceId))
      .orderBy(desc(campaigns.updatedAt))
      .limit(200);
  }

  /** Creates the campaign shell plus its first draft version atomically. */
  public async createCampaign(input: {
    name: string;
    description: string;
    timezone: string;
    graph: string;
  }): Promise<{ id: string; draftVersionId: string }> {
    const id = uuidv7();
    const draftVersionId = uuidv7();
    const now = new Date().toISOString();
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(campaigns).values({
        id,
        workspaceId: this.context.workspaceId,
        name: input.name,
        description: input.description,
        status: "draft",
        draftVersionId,
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(campaignVersions).values({
        id: draftVersionId,
        workspaceId: this.context.workspaceId,
        campaignId: id,
        version: 1,
        status: "draft",
        timezone: input.timezone,
        graph: input.graph,
        createdAt: now,
      }),
    ]);
    return { id, draftVersionId };
  }

  /** The draft graph of one campaign plus the campaign status. */
  public async getDraft(campaignId: string): Promise<{ graph: string; status: string } | null> {
    const row = await this.database.orm
      .select({ graph: campaignVersions.graph, status: campaigns.status })
      .from(campaigns)
      .innerJoin(
        campaignVersions,
        and(
          eq(campaignVersions.id, campaigns.draftVersionId),
          eq(campaignVersions.workspaceId, campaigns.workspaceId),
        ),
      )
      .where(and(eq(campaigns.workspaceId, this.context.workspaceId), eq(campaigns.id, campaignId)))
      .get();
    return row ?? null;
  }

  /**
   * Stores the draft graph, then refreshes the campaign metadata. Returns
   * false — without touching the metadata — when the campaign has no
   * editable draft version.
   */
  public async saveDraft(
    campaignId: string,
    input: { name: string; description: string; timezone: string; graph: string },
  ): Promise<boolean> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const draftVersionOf = orm
      .select({ id: campaigns.draftVersionId })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId)));
    const result = await orm
      .update(campaignVersions)
      .set({ timezone: input.timezone, graph: input.graph })
      .where(
        and(
          eq(campaignVersions.workspaceId, workspaceId),
          eq(campaignVersions.id, draftVersionOf),
          eq(campaignVersions.status, "draft"),
        ),
      );
    if (result.meta.changes === 0) return false;
    await orm
      .update(campaigns)
      .set({
        name: input.name,
        description: input.description,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId)));
    return true;
  }

  /** The campaign's current draft version, if it is still publishable. */
  public async findPublishableDraft(
    campaignId: string,
  ): Promise<{ draftVersionId: string; version: number; graph: string } | null> {
    const row = await this.database.orm
      .select({
        draftVersionId: campaignVersions.id,
        version: campaignVersions.version,
        graph: campaignVersions.graph,
      })
      .from(campaigns)
      .innerJoin(
        campaignVersions,
        and(
          eq(campaignVersions.id, campaigns.draftVersionId),
          eq(campaignVersions.workspaceId, campaigns.workspaceId),
        ),
      )
      .where(
        and(
          eq(campaigns.workspaceId, this.context.workspaceId),
          eq(campaigns.id, campaignId),
          eq(campaignVersions.status, "draft"),
        ),
      )
      .get();
    return row ?? null;
  }

  /** Of the given templates, those synced to Resend and ready to send. */
  public async listPublishedTemplateIds(templateIds: string[]): Promise<string[]> {
    const rows = await this.database.orm
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, this.context.workspaceId),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.remoteStatus, "published"),
          isNull(emailTemplates.syncError),
          inArray(emailTemplates.id, templateIds),
        ),
      );
    return rows.map((row) => row.id);
  }

  /**
   * Publishes the draft in one atomic batch: publish the version, open the
   * next draft, point the campaign at both versions, and replace the trigger
   * registration. Returns the id of the freshly opened draft.
   */
  public async publishDraft(input: {
    campaignId: string;
    draftVersionId: string;
    currentVersion: number;
    timezone: string;
    graph: string;
    trigger: {
      sourceNodeId: string;
      source: string;
      eventType: string | null;
      resourceId: string | null;
      reentry: "once" | "every_time";
      inactivityDays: number | null;
    };
  }): Promise<{ draftVersionId: string }> {
    const workspaceId = this.context.workspaceId;
    const nextDraftId = uuidv7();
    const now = new Date().toISOString();
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(campaignVersions)
        .set({ status: "published", publishedAt: now })
        .where(
          and(
            eq(campaignVersions.workspaceId, workspaceId),
            eq(campaignVersions.id, input.draftVersionId),
            eq(campaignVersions.status, "draft"),
          ),
        ),
      orm.insert(campaignVersions).values({
        id: nextDraftId,
        workspaceId,
        campaignId: input.campaignId,
        version: input.currentVersion + 1,
        status: "draft",
        timezone: input.timezone,
        graph: input.graph,
        createdAt: now,
      }),
      orm
        .update(campaigns)
        .set({
          status: "active",
          publishedVersionId: input.draftVersionId,
          draftVersionId: nextDraftId,
          updatedAt: now,
        })
        .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, input.campaignId))),
      orm
        .delete(campaignTriggers)
        .where(
          and(
            eq(campaignTriggers.workspaceId, workspaceId),
            eq(campaignTriggers.campaignId, input.campaignId),
          ),
        ),
      orm.insert(campaignTriggers).values({
        campaignVersionId: input.draftVersionId,
        workspaceId,
        campaignId: input.campaignId,
        sourceNodeId: input.trigger.sourceNodeId,
        source: input.trigger.source,
        eventType: input.trigger.eventType,
        resourceId: input.trigger.resourceId,
        reentry: input.trigger.reentry,
        inactivityDays: input.trigger.inactivityDays,
        createdAt: now,
      }),
    ]);
    return { draftVersionId: nextDraftId };
  }

  /** Pauses or resumes a published campaign; false when nothing was changeable. */
  public async setCampaignStatus(
    campaignId: string,
    status: "active" | "paused",
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(campaigns)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(campaigns.workspaceId, this.context.workspaceId),
          eq(campaigns.id, campaignId),
          isNotNull(campaigns.publishedVersionId),
          inArray(campaigns.status, ["active", "paused"]),
        ),
      );
    return result.meta.changes === 1;
  }

  /** Published triggers of active campaigns listening for this event. */
  public async listActiveTriggersForEvent(
    eventType: string,
    resourceId: string | null,
  ): Promise<
    Array<{ campaignVersionId: string; campaignId: string; sourceNodeId: string; reentry: string }>
  > {
    // `resource_id = NULL` never matches, so a null event resource narrows
    // the raw `(resource_id IS NULL OR resource_id = ?)` to the IS NULL arm.
    const resourceCondition =
      resourceId === null
        ? isNull(campaignTriggers.resourceId)
        : or(isNull(campaignTriggers.resourceId), eq(campaignTriggers.resourceId, resourceId));
    return await this.database.orm
      .select({
        campaignVersionId: campaignTriggers.campaignVersionId,
        campaignId: campaignTriggers.campaignId,
        sourceNodeId: campaignTriggers.sourceNodeId,
        reentry: campaignTriggers.reentry,
      })
      .from(campaignTriggers)
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.workspaceId, campaignTriggers.workspaceId),
          eq(campaigns.id, campaignTriggers.campaignId),
        ),
      )
      .where(
        and(
          eq(campaignTriggers.workspaceId, this.context.workspaceId),
          eq(campaigns.status, "active"),
          eq(campaigns.publishedVersionId, campaignTriggers.campaignVersionId),
          eq(campaignTriggers.eventType, eventType),
          resourceCondition,
        ),
      );
  }

  /** The published version (id + graph) of one active campaign. */
  public async findActivePublishedCampaign(
    campaignId: string,
  ): Promise<{ publishedVersionId: string; graph: string } | null> {
    const row = await this.database.orm
      .select({ publishedVersionId: campaignVersions.id, graph: campaignVersions.graph })
      .from(campaigns)
      .innerJoin(
        campaignVersions,
        and(
          eq(campaignVersions.id, campaigns.publishedVersionId),
          eq(campaignVersions.workspaceId, campaigns.workspaceId),
        ),
      )
      .where(
        and(
          eq(campaigns.workspaceId, this.context.workspaceId),
          eq(campaigns.id, campaignId),
          eq(campaigns.status, "active"),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Enrolls a contact and creates the first job ('pending') in one atomic
   * batch. The enrollment row is inserted via SELECT so a missing or
   * archived contact inserts nothing and the job's FK aborts the batch; that
   * — like a duplicate (workspace, campaign, contact, source event) — comes
   * back as a constraint violation and is reported as null. Note the
   * caller-provided sourceEventId may be the "once" re-entry sentinel.
   */
  public async enrollContact(input: {
    campaignId: string;
    campaignVersionId: string;
    sourceNodeId: string;
    contactId: string;
    sourceEventId: string;
  }): Promise<{ enrollmentId: string; jobId: string } | null> {
    const workspaceId = this.context.workspaceId;
    const enrollmentId = uuidv7();
    const jobId = uuidv7();
    const now = new Date().toISOString();
    const orm = this.database.orm;
    try {
      await orm.batch([
        // insert-from-select: drizzle emits the full column list in
        // declaration order, so the SELECT lists every campaign_enrollments
        // column in exactly that order.
        orm.insert(campaignEnrollments).select(
          orm
            .select({
              id: sql<string>`${enrollmentId}`.as("id"),
              workspaceId: contacts.workspaceId,
              campaignId: sql<string>`${input.campaignId}`.as("campaign_id"),
              campaignVersionId: sql<string>`${input.campaignVersionId}`.as("campaign_version_id"),
              contactId: contacts.id,
              sourceEventId: sql<string>`${input.sourceEventId}`.as("source_event_id"),
              status: sql<string>`'active'`.as("status"),
              currentNodeId: sql<string>`${input.sourceNodeId}`.as("current_node_id"),
              enteredAt: sql<string>`${now}`.as("entered_at"),
              completedAt: sql<string | null>`NULL`.as("completed_at"),
              updatedAt: sql<string>`${now}`.as("updated_at"),
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, workspaceId),
                eq(contacts.id, input.contactId),
                ne(contacts.status, "archived"),
              ),
            ),
        ),
        orm.insert(campaignJobs).values({
          id: jobId,
          workspaceId,
          enrollmentId,
          campaignVersionId: input.campaignVersionId,
          nodeId: input.sourceNodeId,
          recipientId: input.contactId,
          idempotencyKey: `${enrollmentId}:${input.sourceNodeId}:${input.contactId}`,
          status: "pending",
          dueAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      return { enrollmentId, jobId };
    } catch (error) {
      if (isConstraintError(error)) return null;
      throw error;
    }
  }

  /** COUNT of this campaign's enrollments, optionally narrowed to one status. */
  private enrollmentCountExpression(status?: "active" | "completed") {
    const conditions = [
      eq(campaignEnrollments.workspaceId, campaigns.workspaceId),
      eq(campaignEnrollments.campaignId, campaigns.id),
    ];
    if (status) conditions.push(eq(campaignEnrollments.status, status));
    return sql<number>`${this.database.orm.$count(campaignEnrollments, and(...conditions))}`.mapWith(
      Number,
    );
  }
}

/** D1 surfaces every unique/FK batch failure as a constraint message. */
function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique|foreign key/i.test(message);
}

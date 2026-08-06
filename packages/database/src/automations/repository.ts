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

import { assertJobTransition, type JobStatus } from "@openengage/core";
import {
  automationDefinitionSchema,
  type AutomationDefinition,
} from "@openengage/core/automations";
import { jsonRecordSchema, type JsonRecord, type WorkspaceContext } from "@openengage/core/shared";

import { createDatabase, type DatabaseSource, type OpenEngageDatabase } from "../client";
import { contactEvents, contacts, contactTags, tags } from "../contacts/schema";
import { scoreEvents } from "../contacts/score-schema";
import { emailTemplates } from "../messaging/schema";
import { segmentMemberships } from "../segments/schema";
import { isConstraintError } from "../shared/database-utils";
import { decodeJson, encodeJson } from "../shared/json-codec";
import { uuidv7 } from "../shared/uuid";
import {
  automationEnrollments,
  automationJobs,
  automations,
  automationTriggers,
  automationVersions,
} from "./schema";

/** automation_jobs.status vocabulary (mirrors the table CHECK constraint). */
export type AutomationJobStatus =
  | "pending"
  | "leased"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * automation_jobs speaks an older dialect of the shared job state machine in
 * `@openengage/core`: `running`/`succeeded` are the machine's
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
} as const satisfies Record<AutomationJobStatus, JobStatus>;

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
 * Routes a automation_jobs status write through the shared job state machine.
 * Every hop of the (possibly collapsed) machine path is asserted, so an
 * UPDATE that would skip or reverse the machine throws before touching the
 * database. Writes stay conditional (`WHERE status = expected`) on top of
 * this, preserving the optimistic-concurrency behavior the worker relies on.
 */
function assertAutomationJobTransition(from: AutomationJobStatus, to: AutomationJobStatus): void {
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
 * One executable automation job joined with the graph, enrollment and contact
 * data the worker needs. JSON columns are decoded and validated before the
 * row leaves the database package.
 */
export interface AutomationJobRow {
  id: string;
  workspaceId: string;
  enrollmentId: string;
  automationVersionId: string;
  nodeId: string;
  contactId: string;
  idempotencyKey: string;
  payload: JsonRecord;
  status: string;
  leaseId: string | null;
  attempts: number;
  createdAt: string;
  enteredAt: string;
  graph: AutomationDefinition;
  contactEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  stage: string;
  score: number;
  customFields: JsonRecord;
}

/** Contact columns an automation "update_field" action may write directly. */
const AUTOMATION_CONTACT_COLUMNS = {
  first_name: "firstName",
  last_name: "lastName",
  phone: "phone",
  stage: "stage",
  external_id: "externalId",
} as const;

export type AutomationContactColumn = keyof typeof AUTOMATION_CONTACT_COLUMNS;

/**
 * Worker-side store for the automation engine. Deliberately unscoped: the
 * dispatcher scans and claims jobs across every workspace, and the queue
 * consumer locates a job by (id, lease id) alone — the workspace always comes
 * from the claimed row itself, never from a session.
 *
 * Contact/tag/segment mutations here implement automation-action semantics
 * (no archived-contact guard, membership source 'automation'), which is why
 * they exist alongside the stricter ContactResourceRepository methods.
 */
export class AutomationEngineRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(database: DatabaseSource) {
    this.database = createDatabase(database);
  }

  /** Workspaces holding due pending jobs, oldest due first (dispatch fan-out). */
  public async workspacesWithDueJobs(
    now: string,
    limit = 50,
  ): Promise<Array<{ workspaceId: string }>> {
    const oldest = sql<string>`MIN(${automationJobs.dueAt})`.as("oldest");
    const rows = await this.database.orm
      .select({ workspaceId: automationJobs.workspaceId, oldest })
      .from(automationJobs)
      .where(and(eq(automationJobs.status, "pending"), lte(automationJobs.dueAt, now)))
      .groupBy(automationJobs.workspaceId)
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
      eq(automationJobs.status, "pending"),
      lte(automationJobs.dueAt, now),
      or(isNull(automationJobs.leaseUntil), lt(automationJobs.leaseUntil, now))!,
    ];
    if (workspaceId) conditions.push(eq(automationJobs.workspaceId, workspaceId));
    const candidates = await orm
      .select({ id: automationJobs.id })
      .from(automationJobs)
      .where(and(...conditions))
      .orderBy(asc(automationJobs.dueAt))
      .limit(limit);
    const claims = candidates.map((candidate) => ({ id: candidate.id, leaseId: uuidv7() }));
    const [first, ...rest] = claims.map((claim) =>
      orm
        .update(automationJobs)
        .set({ status: "leased", leaseId: claim.leaseId, leaseUntil, updatedAt: now })
        .where(
          and(
            eq(automationJobs.id, claim.id),
            eq(automationJobs.status, "pending"),
            or(isNull(automationJobs.leaseUntil), lt(automationJobs.leaseUntil, now)),
          ),
        ),
    );
    if (!first) return [];
    assertAutomationJobTransition("pending", "leased");
    const results = await orm.batch([first, ...rest]);
    return claims.filter((_, index) => results[index]?.meta.changes === 1);
  }

  /** Loads a leased/running job with its graph, enrollment and contact row. */
  public async findJobForProcessing(
    jobId: string,
    leaseId: string,
  ): Promise<AutomationJobRow | null> {
    const row = await this.database.orm
      .select({
        id: automationJobs.id,
        workspaceId: automationJobs.workspaceId,
        enrollmentId: automationJobs.enrollmentId,
        automationVersionId: automationJobs.automationVersionId,
        nodeId: automationJobs.nodeId,
        contactId: automationJobs.contactId,
        idempotencyKey: automationJobs.idempotencyKey,
        payload: automationJobs.payload,
        status: automationJobs.status,
        leaseId: automationJobs.leaseId,
        attempts: automationJobs.attempts,
        createdAt: automationJobs.createdAt,
        enteredAt: automationEnrollments.enteredAt,
        graph: automationVersions.graph,
        contactEmail: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        stage: contacts.stage,
        score: contacts.score,
        customFields: contacts.customFields,
      })
      .from(automationJobs)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automationJobs.automationVersionId),
          eq(automationVersions.workspaceId, automationJobs.workspaceId),
        ),
      )
      .innerJoin(
        automationEnrollments,
        and(
          eq(automationEnrollments.id, automationJobs.enrollmentId),
          eq(automationEnrollments.workspaceId, automationJobs.workspaceId),
        ),
      )
      .innerJoin(
        contacts,
        and(
          eq(contacts.id, automationJobs.contactId),
          eq(contacts.workspaceId, automationJobs.workspaceId),
        ),
      )
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          inArray(automationJobs.status, ["leased", "running"]),
        ),
      )
      .get();
    if (!row) return null;
    return {
      ...row,
      graph: decodeJson(row.graph, automationDefinitionSchema, "automation_versions.graph"),
      payload: decodeJson(row.payload, jsonRecordSchema, "automation_jobs.payload"),
      customFields: decodeJson(row.customFields, jsonRecordSchema, "contacts.customFields"),
    };
  }

  /**
   * Marks a leased job running and counts the attempt (leased -> running).
   * Returns false when the row was not in 'leased' anymore — the caller then
   * decides whether it already owns a running row.
   */
  public async startLeasedJob(jobId: string, leaseId: string, now: string): Promise<boolean> {
    assertAutomationJobTransition("leased", "running");
    const result = await this.database.orm
      .update(automationJobs)
      .set({ status: "running", attempts: sql`${automationJobs.attempts} + 1`, updatedAt: now })
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "leased"),
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
    assertAutomationJobTransition("running", "pending");
    await this.database.orm
      .update(automationJobs)
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
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "running"),
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
    assertAutomationJobTransition("running", "leased");
    await this.database.orm
      .update(automationJobs)
      .set({ status: "leased", lastError, updatedAt: now })
      .where(
        and(
          eq(automationJobs.id, jobId),
          eq(automationJobs.leaseId, leaseId),
          eq(automationJobs.status, "running"),
        ),
      );
  }

  /**
   * Terminal node: succeeds the job and completes the enrollment in one
   * atomic batch (running -> succeeded). The job UPDATE matches on the lease
   * alone — the holder finishes its row regardless of status races.
   */
  public async completeJobClosingEnrollment(
    job: Pick<AutomationJobRow, "id" | "workspaceId" | "enrollmentId">,
    leaseId: string,
    now: string,
  ): Promise<void> {
    assertAutomationJobTransition("running", "succeeded");
    const orm = this.database.orm;
    await orm.batch([
      this.jobSucceededUpdate(job.id, leaseId, now),
      orm
        .update(automationEnrollments)
        .set({ status: "completed", currentNodeId: null, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(automationEnrollments.workspaceId, job.workspaceId),
            eq(automationEnrollments.id, job.enrollmentId),
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
      AutomationJobRow,
      "id" | "workspaceId" | "enrollmentId" | "automationVersionId" | "contactId"
    >,
    leaseId: string,
    nextNodeId: string,
    now: string,
  ): Promise<void> {
    assertAutomationJobTransition("running", "succeeded");
    const orm = this.database.orm;
    await orm.batch([
      this.jobSucceededUpdate(job.id, leaseId, now),
      orm
        .insert(automationJobs)
        .values({
          id: uuidv7(),
          workspaceId: job.workspaceId,
          enrollmentId: job.enrollmentId,
          automationVersionId: job.automationVersionId,
          nodeId: nextNodeId,
          contactId: job.contactId,
          idempotencyKey: `${job.enrollmentId}:${nextNodeId}:${job.contactId}`,
          status: "pending",
          dueAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      orm
        .update(automationEnrollments)
        .set({ currentNodeId: nextNodeId, updatedAt: now })
        .where(
          and(
            eq(automationEnrollments.workspaceId, job.workspaceId),
            eq(automationEnrollments.id, job.enrollmentId),
            eq(automationEnrollments.status, "active"),
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
   * add_segment action: joins the contact with source 'automation'. Returns
   * whether a row was written, so the caller can emit `segment_joined` only
   * on a fresh membership.
   */
  public async addAutomationSegmentMembership(
    workspaceId: string,
    segmentId: string,
    contactId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.database.orm
      .insert(segmentMemberships)
      .values({ workspaceId, segmentId, contactId, source: "automation", joinedAt: now })
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
   * against the enrollment, atomically. The delta is applied as a SQL
   * expression (not read-then-write) so the whole operation - not just the
   * two writes - is race-free against a concurrent adjustment.
   */
  public async adjustContactScoreForEnrollment(
    workspaceId: string,
    contactId: string,
    enrollmentId: string,
    amount: number,
    now: string,
  ): Promise<void> {
    const orm = this.database.orm;
    await orm.batch([
      orm
        .update(contacts)
        .set({ score: sql`${contacts.score} + ${amount}`, updatedAt: now })
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId))),
      orm.insert(scoreEvents).values({
        id: uuidv7(),
        workspaceId,
        contactId,
        delta: amount,
        reason: "automation",
        automationEnrollmentId: enrollmentId,
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
   * active automations whose latest event (or creation) is at least
   * `inactivity_days` before `now`, excluding contacts already enrolled via
   * the "once" sentinel.
   */
  public async listInactiveEnrollmentCandidates(
    now: string,
    limit: number,
  ): Promise<
    Array<{
      automationVersionId: string;
      automationId: string;
      sourceNodeId: string;
      reentry: string;
      workspaceId: string;
      contactId: string;
    }>
  > {
    const orm = this.database.orm;
    return await orm
      .select({
        automationVersionId: automationTriggers.automationVersionId,
        automationId: automationTriggers.automationId,
        sourceNodeId: automationTriggers.sourceNodeId,
        reentry: automationTriggers.reentry,
        workspaceId: contacts.workspaceId,
        contactId: contacts.id,
      })
      .from(automationTriggers)
      .innerJoin(
        automations,
        and(
          eq(automations.workspaceId, automationTriggers.workspaceId),
          eq(automations.id, automationTriggers.automationId),
        ),
      )
      .innerJoin(contacts, eq(contacts.workspaceId, automationTriggers.workspaceId))
      .where(
        and(
          eq(automationTriggers.source, "contact_inactive"),
          eq(automations.status, "active"),
          eq(automations.publishedVersionId, automationTriggers.automationVersionId),
          eq(contacts.status, "active"),
          sql`julianday(COALESCE((
            SELECT MAX(${contactEvents.occurredAt}) FROM ${contactEvents}
            WHERE ${contactEvents.workspaceId} = ${contacts.workspaceId}
              AND ${contactEvents.contactId} = ${contacts.id}
          ), ${contacts.createdAt})) <= julianday(${now}) - ${automationTriggers.inactivityDays}`,
          notExists(
            orm
              .select({ value: sql`1` })
              .from(automationEnrollments)
              .where(
                and(
                  eq(automationEnrollments.workspaceId, automationTriggers.workspaceId),
                  eq(automationEnrollments.automationId, automationTriggers.automationId),
                  eq(automationEnrollments.contactId, contacts.id),
                  eq(automationEnrollments.sourceEventId, "once"),
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
      .update(automationJobs)
      .set({ status: "succeeded", leaseId: null, leaseUntil: null, updatedAt: now })
      .where(and(eq(automationJobs.id, jobId), eq(automationJobs.leaseId, leaseId)));
  }
}

/**
 * Legacy free-function entry point for the dispatcher; claims due pending
 * jobs across (or within) workspaces. Delegates to
 * {@link AutomationEngineRepository.claimDueJobs}.
 */
export async function claimDueJobs(
  database: DatabaseSource,
  now: string,
  leaseUntil: string,
  limit = 100,
  workspaceId?: string,
): Promise<Array<{ id: string; leaseId: string }>> {
  return new AutomationEngineRepository(database).claimDueJobs(now, leaseUntil, limit, workspaceId);
}

/**
 * Workspace-scoped automation store: admin CRUD, the publish pipeline and
 * enrollment writes. Scoped by workspace id only, because event-driven
 * enrollment flows resolve just the workspace id; a full
 * {@link WorkspaceContext} is assignable wherever this scope is expected.
 */
export class AutomationRepository {
  private readonly database: OpenEngageDatabase;

  public constructor(
    database: DatabaseSource,
    public readonly context: Pick<WorkspaceContext, "workspaceId">,
  ) {
    this.database = createDatabase(database);
  }

  /** Automation list rows with enrollment counters and the published trigger source. */
  public async listAutomationsWithCounts(): Promise<
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
      .select({ source: automationTriggers.source })
      .from(automationTriggers)
      .where(
        and(
          eq(automationTriggers.workspaceId, automations.workspaceId),
          eq(automationTriggers.automationVersionId, automations.publishedVersionId),
        ),
      );
    return await this.database.orm
      .select({
        id: automations.id,
        name: automations.name,
        description: automations.description,
        status: automations.status,
        triggerSource: sql<string | null>`${triggerSourceQuery}`.as("trigger_source"),
        enrollmentCount: this.enrollmentCountExpression().as("enrollment_count"),
        activeCount: this.enrollmentCountExpression("active").as("active_count"),
        completedCount: this.enrollmentCountExpression("completed").as("completed_count"),
        updatedAt: automations.updatedAt,
      })
      .from(automations)
      .where(eq(automations.workspaceId, this.context.workspaceId))
      .orderBy(desc(automations.updatedAt))
      .limit(200);
  }

  /** Creates the automation shell plus its first draft version atomically. */
  public async createAutomation(input: {
    name: string;
    description: string;
    timezone: string;
    graph: AutomationDefinition;
  }): Promise<{ id: string; draftVersionId: string }> {
    const id = uuidv7();
    const draftVersionId = uuidv7();
    const now = new Date().toISOString();
    const orm = this.database.orm;
    await orm.batch([
      orm.insert(automations).values({
        id,
        workspaceId: this.context.workspaceId,
        name: input.name,
        description: input.description,
        status: "draft",
        draftVersionId,
        createdAt: now,
        updatedAt: now,
      }),
      orm.insert(automationVersions).values({
        id: draftVersionId,
        workspaceId: this.context.workspaceId,
        automationId: id,
        version: 1,
        status: "draft",
        timezone: input.timezone,
        graph: encodeJson(input.graph, automationDefinitionSchema, "automation_versions.graph"),
        createdAt: now,
      }),
    ]);
    return { id, draftVersionId };
  }

  /** The draft graph of one automation plus the automation status. */
  public async getDraft(
    automationId: string,
  ): Promise<{ graph: AutomationDefinition; status: string } | null> {
    const row = await this.database.orm
      .select({ graph: automationVersions.graph, status: automations.status })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.draftVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          eq(automations.workspaceId, this.context.workspaceId),
          eq(automations.id, automationId),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          graph: decodeJson(row.graph, automationDefinitionSchema, "automation_versions.graph"),
        }
      : null;
  }

  /**
   * Stores the draft graph, then refreshes the automation metadata. Returns
   * false — without touching the metadata — when the automation has no
   * editable draft version.
   */
  public async saveDraft(
    automationId: string,
    input: { name: string; description: string; timezone: string; graph: AutomationDefinition },
  ): Promise<boolean> {
    const workspaceId = this.context.workspaceId;
    const orm = this.database.orm;
    const draftVersionOf = orm
      .select({ id: automations.draftVersionId })
      .from(automations)
      .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)));
    const result = await orm
      .update(automationVersions)
      .set({
        timezone: input.timezone,
        graph: encodeJson(input.graph, automationDefinitionSchema, "automation_versions.graph"),
      })
      .where(
        and(
          eq(automationVersions.workspaceId, workspaceId),
          eq(automationVersions.id, draftVersionOf),
          eq(automationVersions.status, "draft"),
        ),
      );
    if (result.meta.changes === 0) return false;
    await orm
      .update(automations)
      .set({
        name: input.name,
        description: input.description,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)));
    return true;
  }

  /** The automation's current draft version, if it is still publishable. */
  public async findPublishableDraft(
    automationId: string,
  ): Promise<{ draftVersionId: string; version: number; graph: AutomationDefinition } | null> {
    const row = await this.database.orm
      .select({
        draftVersionId: automationVersions.id,
        version: automationVersions.version,
        graph: automationVersions.graph,
      })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.draftVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          eq(automations.workspaceId, this.context.workspaceId),
          eq(automations.id, automationId),
          eq(automationVersions.status, "draft"),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          graph: decodeJson(row.graph, automationDefinitionSchema, "automation_versions.graph"),
        }
      : null;
  }

  /** Of the given templates, those published locally and ready to send. */
  public async listPublishedTemplateIds(templateIds: string[]): Promise<string[]> {
    const rows = await this.database.orm
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, this.context.workspaceId),
          isNull(emailTemplates.archivedAt),
          eq(emailTemplates.purpose, "transactional"),
          isNotNull(emailTemplates.publishedRevision),
          inArray(emailTemplates.id, templateIds),
        ),
      );
    return rows.map((row) => row.id);
  }

  /**
   * Publishes the draft in one atomic batch: publish the version, open the
   * next draft, point the automation at both versions, and replace the trigger
   * registration. Returns the id of the freshly opened draft.
   */
  public async publishDraft(input: {
    automationId: string;
    draftVersionId: string;
    currentVersion: number;
    timezone: string;
    graph: AutomationDefinition;
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
        .update(automationVersions)
        .set({ status: "published", publishedAt: now })
        .where(
          and(
            eq(automationVersions.workspaceId, workspaceId),
            eq(automationVersions.id, input.draftVersionId),
            eq(automationVersions.status, "draft"),
          ),
        ),
      orm.insert(automationVersions).values({
        id: nextDraftId,
        workspaceId,
        automationId: input.automationId,
        version: input.currentVersion + 1,
        status: "draft",
        timezone: input.timezone,
        graph: encodeJson(input.graph, automationDefinitionSchema, "automation_versions.graph"),
        createdAt: now,
      }),
      orm
        .update(automations)
        .set({
          status: "active",
          publishedVersionId: input.draftVersionId,
          draftVersionId: nextDraftId,
          updatedAt: now,
        })
        .where(
          and(eq(automations.workspaceId, workspaceId), eq(automations.id, input.automationId)),
        ),
      orm
        .delete(automationTriggers)
        .where(
          and(
            eq(automationTriggers.workspaceId, workspaceId),
            eq(automationTriggers.automationId, input.automationId),
          ),
        ),
      orm.insert(automationTriggers).values({
        automationVersionId: input.draftVersionId,
        workspaceId,
        automationId: input.automationId,
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

  /** Pauses or resumes a published automation; false when nothing was changeable. */
  public async setAutomationStatus(
    automationId: string,
    status: "active" | "paused",
  ): Promise<boolean> {
    const result = await this.database.orm
      .update(automations)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(automations.workspaceId, this.context.workspaceId),
          eq(automations.id, automationId),
          isNotNull(automations.publishedVersionId),
          inArray(automations.status, ["active", "paused"]),
        ),
      );
    return result.meta.changes === 1;
  }

  /** Published triggers of active automations listening for this event. */
  public async listActiveTriggersForEvent(
    eventType: string,
    resourceId: string | null,
  ): Promise<
    Array<{
      automationVersionId: string;
      automationId: string;
      sourceNodeId: string;
      reentry: string;
    }>
  > {
    // `resource_id = NULL` never matches, so a null event resource narrows
    // the raw `(resource_id IS NULL OR resource_id = ?)` to the IS NULL arm.
    const resourceCondition =
      resourceId === null
        ? isNull(automationTriggers.resourceId)
        : or(isNull(automationTriggers.resourceId), eq(automationTriggers.resourceId, resourceId));
    return await this.database.orm
      .select({
        automationVersionId: automationTriggers.automationVersionId,
        automationId: automationTriggers.automationId,
        sourceNodeId: automationTriggers.sourceNodeId,
        reentry: automationTriggers.reentry,
      })
      .from(automationTriggers)
      .innerJoin(
        automations,
        and(
          eq(automations.workspaceId, automationTriggers.workspaceId),
          eq(automations.id, automationTriggers.automationId),
        ),
      )
      .where(
        and(
          eq(automationTriggers.workspaceId, this.context.workspaceId),
          eq(automations.status, "active"),
          eq(automations.publishedVersionId, automationTriggers.automationVersionId),
          eq(automationTriggers.eventType, eventType),
          resourceCondition,
        ),
      );
  }

  /** The published version (id + graph) of one active automation. */
  public async findActivePublishedAutomation(
    automationId: string,
  ): Promise<{ publishedVersionId: string; graph: AutomationDefinition } | null> {
    const row = await this.database.orm
      .select({ publishedVersionId: automationVersions.id, graph: automationVersions.graph })
      .from(automations)
      .innerJoin(
        automationVersions,
        and(
          eq(automationVersions.id, automations.publishedVersionId),
          eq(automationVersions.workspaceId, automations.workspaceId),
        ),
      )
      .where(
        and(
          eq(automations.workspaceId, this.context.workspaceId),
          eq(automations.id, automationId),
          eq(automations.status, "active"),
        ),
      )
      .get();
    return row
      ? {
          ...row,
          graph: decodeJson(row.graph, automationDefinitionSchema, "automation_versions.graph"),
        }
      : null;
  }

  /**
   * Enrolls a contact and creates the first job ('pending') in one atomic
   * batch. The enrollment row is inserted via SELECT so a missing or
   * archived contact inserts nothing and the job's FK aborts the batch; that
   * — like a duplicate (workspace, automation, contact, source event) — comes
   * back as a constraint violation and is reported as null. Note the
   * caller-provided sourceEventId may be the "once" re-entry sentinel.
   */
  public async enrollContact(input: {
    automationId: string;
    automationVersionId: string;
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
        // declaration order, so the SELECT lists every automation_enrollments
        // column in exactly that order.
        orm.insert(automationEnrollments).select(
          orm
            .select({
              id: sql<string>`${enrollmentId}`.as("id"),
              workspaceId: contacts.workspaceId,
              automationId: sql<string>`${input.automationId}`.as("automation_id"),
              automationVersionId: sql<string>`${input.automationVersionId}`.as(
                "automation_version_id",
              ),
              contactId: contacts.id,
              sourceEventId: sql<string>`${input.sourceEventId}`.as("source_event_id"),
              status: sql<string>`'active'`.as("status"),
              currentNodeId: sql<string>`${input.sourceNodeId}`.as("current_nodeId"),
              enteredAt: sql<string>`${now}`.as("enteredAt"),
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
        orm.insert(automationJobs).values({
          id: jobId,
          workspaceId,
          enrollmentId,
          automationVersionId: input.automationVersionId,
          nodeId: input.sourceNodeId,
          contactId: input.contactId,
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

  /** COUNT of this automation's enrollments, optionally narrowed to one status. */
  private enrollmentCountExpression(status?: "active" | "completed") {
    const conditions = [
      eq(automationEnrollments.workspaceId, automations.workspaceId),
      eq(automationEnrollments.automationId, automations.id),
    ];
    if (status) conditions.push(eq(automationEnrollments.status, status));
    return sql<number>`${this.database.orm.$count(automationEnrollments, and(...conditions))}`.mapWith(
      Number,
    );
  }
}

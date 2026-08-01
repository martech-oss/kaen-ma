import { PermanentChannelError } from "@kaenma/channels";
import { computeDueAt, outgoingEdges } from "@kaenma/core";
import { createDatabase, uuidv7 } from "@kaenma/database";
import {
  campaignDefinitionSchema,
  type CampaignDefinition,
  type CampaignEdge,
  type CampaignNode,
} from "@kaenma/orpc";

import { recordContactEvent } from "../contacts/event-service";
import { type RuntimeEnv } from "../env";
import { createEmailDelivery, createWebhookDelivery } from "../messaging/delivery-worker";
import { parseJsonRecord } from "../platform/values";
import { primitiveString } from "../platform/values";

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

export async function processCampaignJob(
  jobId: string,
  leaseId: string,
  env: RuntimeEnv,
): Promise<void> {
  const job = await createDatabase(env.DB)
    .prepare(
      `SELECT j.*, cv.graph, enrollment.entered_at,
            c.email AS contact_email, c.first_name, c.last_name, c.phone,
            c.stage, c.score, c.custom_fields
     FROM campaign_jobs j
     JOIN campaign_versions cv ON cv.id = j.campaign_version_id
       AND cv.workspace_id = j.workspace_id
     JOIN campaign_enrollments enrollment ON enrollment.id = j.enrollment_id
       AND enrollment.workspace_id = j.workspace_id
     JOIN contacts c ON c.id = j.recipient_id AND c.workspace_id = j.workspace_id
     WHERE j.id = ? AND j.lease_id = ? AND j.status IN ('leased', 'running')`,
    )
    .bind(jobId, leaseId)
    .first<CampaignJobRow>();
  if (!job) return;
  const claimed = await createDatabase(env.DB)
    .prepare(
      `UPDATE campaign_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND lease_id = ? AND status = 'leased'`,
    )
    .bind(new Date().toISOString(), jobId, leaseId)
    .run();
  if (claimed.meta.changes === 0 && job.status !== "running") return;

  try {
    const definition = campaignDefinitionSchema.parse(JSON.parse(job.graph));
    const node = definition.nodes.find((candidate) => candidate.id === job.node_id);
    if (!node) throw new PermanentChannelError(`Campaign node ${job.node_id} is missing`);
    const result = await executeNode(node, definition, job, env);
    if (result.waitUntil) {
      await createDatabase(env.DB)
        .prepare(
          `UPDATE campaign_jobs SET status = 'pending', due_at = ?, payload = ?,
         lease_id = NULL, lease_until = NULL, updated_at = ?
         WHERE id = ? AND lease_id = ? AND status = 'running'`,
        )
        .bind(
          result.waitUntil,
          JSON.stringify({ waiting: true }),
          new Date().toISOString(),
          job.id,
          leaseId,
        )
        .run();
      return;
    }
    await finishNode(job, leaseId, definition, result.branch, env);
  } catch (error) {
    await createDatabase(env.DB)
      .prepare(
        `UPDATE campaign_jobs SET status = 'leased', last_error = ?, updated_at = ?
       WHERE id = ? AND lease_id = ? AND status = 'running'`,
      )
      .bind(
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        new Date().toISOString(),
        job.id,
        leaseId,
      )
      .run();
    throw error;
  }
}

export async function executeNode(
  node: CampaignNode,
  definition: CampaignDefinition,
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<{ branch?: CampaignEdge["branch"]; waitUntil?: string }> {
  if (node.type === "source") return { branch: "next" };
  if (node.type === "delay") {
    return {
      branch: "next",
      waitUntil: computeDueAt(node, new Date(), definition.timezone).toISOString(),
    };
  }
  if (node.type === "condition") {
    return { branch: (await evaluateCondition(node, job, env)) ? "yes" : "no" };
  }
  if (node.type === "decision") {
    const eventType = {
      opened: "email_opened",
      clicked: "email_clicked",
      replied: "email_replied",
      page_viewed: "page_viewed",
      form_submitted: "form_submitted",
      custom_event: "custom_event",
    }[node.config.event];
    const found = await createDatabase(env.DB)
      .prepare(
        `SELECT id FROM contact_events
       WHERE workspace_id = ? AND contact_id = ? AND type = ?
         AND occurred_at >= ? AND (? IS NULL OR resource_id = ?)
       LIMIT 1`,
      )
      .bind(
        job.workspace_id,
        job.recipient_id,
        eventType,
        job.entered_at,
        node.config.resourceId ?? null,
        node.config.resourceId ?? null,
      )
      .first();
    if (found) return { branch: "yes" };
    const payload = parseJsonRecord(job.payload);
    if (payload["waiting"] === true) return { branch: "timeout" };
    return {
      waitUntil: new Date(Date.now() + node.config.withinMinutes * 60_000).toISOString(),
    };
  }

  const action = node.config;
  const now = new Date().toISOString();
  switch (action.action) {
    case "send_email":
      await createEmailDelivery(action, job, env);
      break;
    case "send_webhook":
      await createWebhookDelivery(action.endpointId, job, env);
      break;
    case "add_tag":
      await createDatabase(env.DB)
        .prepare(
          `INSERT OR IGNORE INTO contact_tags
         (workspace_id, contact_id, tag_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(job.workspace_id, job.recipient_id, action.tagId, now)
        .run();
      break;
    case "remove_tag":
      await createDatabase(env.DB)
        .prepare(
          "DELETE FROM contact_tags WHERE workspace_id = ? AND contact_id = ? AND tag_id = ?",
        )
        .bind(job.workspace_id, job.recipient_id, action.tagId)
        .run();
      break;
    case "add_segment":
      if (
        (
          await createDatabase(env.DB)
            .prepare(
              `INSERT OR IGNORE INTO segment_memberships
         (workspace_id, segment_id, contact_id, source, joined_at)
         VALUES (?, ?, ?, 'campaign', ?)`,
            )
            .bind(job.workspace_id, action.segmentId, job.recipient_id, now)
            .run()
        ).meta.changes === 1
      ) {
        await recordContactEvent(createDatabase(env.DB), {
          workspaceId: job.workspace_id,
          contactId: job.recipient_id,
          type: "segment_joined",
          resourceType: "segment",
          resourceId: action.segmentId,
        });
      }
      break;
    case "remove_segment":
      await createDatabase(env.DB)
        .prepare(
          `DELETE FROM segment_memberships
         WHERE workspace_id = ? AND segment_id = ? AND contact_id = ?`,
        )
        .bind(job.workspace_id, action.segmentId, job.recipient_id)
        .run();
      break;
    case "change_score": {
      const current = await createDatabase(env.DB)
        .prepare(`SELECT score FROM contacts WHERE workspace_id = ? AND id = ?`)
        .bind(job.workspace_id, job.recipient_id)
        .first<{ score: number }>();
      const total = (current?.score ?? 0) + action.amount;
      await createDatabase(env.DB).batch([
        createDatabase(env.DB)
          .prepare(
            "UPDATE contacts SET score = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
          )
          .bind(total, now, job.workspace_id, job.recipient_id),
        createDatabase(env.DB)
          .prepare(
            `INSERT INTO score_events
           (id, workspace_id, contact_id, delta, total, reason, campaign_enrollment_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'campaign', ?, ?)`,
          )
          .bind(
            uuidv7(),
            job.workspace_id,
            job.recipient_id,
            action.amount,
            total,
            job.enrollment_id,
            now,
          ),
      ]);
      break;
    }
    case "update_field":
      await updateContactField(job, action.field, action.value, env);
      break;
  }
  return { branch: "next" };
}

export async function finishNode(
  job: CampaignJobRow,
  leaseId: string,
  definition: CampaignDefinition,
  branch: CampaignEdge["branch"] | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const next = outgoingEdges(definition, job.node_id, branch ?? "next")[0];
  const now = new Date().toISOString();
  if (!next) {
    await createDatabase(env.DB).batch([
      createDatabase(env.DB)
        .prepare(
          `UPDATE campaign_jobs SET status = 'succeeded', lease_id = NULL,
         lease_until = NULL, updated_at = ? WHERE id = ? AND lease_id = ?`,
        )
        .bind(now, job.id, leaseId),
      createDatabase(env.DB)
        .prepare(
          `UPDATE campaign_enrollments SET status = 'completed', current_node_id = NULL,
         completed_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
        )
        .bind(now, now, job.workspace_id, job.enrollment_id),
    ]);
    return;
  }
  const nextJobId = uuidv7();
  await createDatabase(env.DB).batch([
    createDatabase(env.DB)
      .prepare(
        `UPDATE campaign_jobs SET status = 'succeeded', lease_id = NULL,
       lease_until = NULL, updated_at = ? WHERE id = ? AND lease_id = ?`,
      )
      .bind(now, job.id, leaseId),
    createDatabase(env.DB)
      .prepare(
        `INSERT OR IGNORE INTO campaign_jobs
       (id, workspace_id, enrollment_id, campaign_version_id, node_id,
        recipient_id, idempotency_key, status, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        nextJobId,
        job.workspace_id,
        job.enrollment_id,
        job.campaign_version_id,
        next.target,
        job.recipient_id,
        `${job.enrollment_id}:${next.target}:${job.recipient_id}`,
        now,
        now,
        now,
      ),
    createDatabase(env.DB)
      .prepare(
        `UPDATE campaign_enrollments SET current_node_id = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'active'`,
      )
      .bind(next.target, now, job.workspace_id, job.enrollment_id),
  ]);
}

export async function evaluateCondition(
  node: Extract<CampaignNode, { type: "condition" }>,
  job: CampaignJobRow,
  env: RuntimeEnv,
): Promise<boolean> {
  const fieldMap: Record<string, unknown> = {
    email: job.contact_email,
    first_name: job.first_name,
    last_name: job.last_name,
    phone: job.phone,
    stage: job.stage,
    score: job.score,
    ...parseJsonRecord(job.custom_fields),
  };
  if (node.config.field === "tag") {
    const row = await createDatabase(env.DB)
      .prepare(
        `SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.workspace_id = ? AND ct.contact_id = ? AND t.slug = ? LIMIT 1`,
      )
      .bind(job.workspace_id, job.recipient_id, String(node.config.value ?? ""))
      .first();
    return compare(row !== null, node.config.operator, true);
  }
  return compare(fieldMap[node.config.field], node.config.operator, node.config.value);
}

export function compare(left: unknown, operator: string, right: unknown): boolean {
  if (operator === "exists") return left !== null && left !== undefined;
  if (operator === "not_exists") return left === null || left === undefined;
  if (operator === "eq") return primitiveString(left) === primitiveString(right);
  if (operator === "neq") return primitiveString(left) !== primitiveString(right);
  if (operator === "contains") return primitiveString(left).includes(primitiveString(right));
  if (operator === "starts_with") return primitiveString(left).startsWith(primitiveString(right));
  if (operator === "in") {
    return Array.isArray(right) && right.some((value) => String(value) === String(left));
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  if (operator === "lte") return leftNumber <= rightNumber;
  return false;
}

export async function updateContactField(
  job: CampaignJobRow,
  field: string,
  value: unknown,
  env: RuntimeEnv,
): Promise<void> {
  const columns: Record<string, string> = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    stage: "stage",
    external_id: "external_id",
  };
  const column = columns[field];
  if (column) {
    await createDatabase(env.DB)
      .prepare(
        `UPDATE contacts SET ${column} = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
      )
      .bind(primitiveString(value), new Date().toISOString(), job.workspace_id, job.recipient_id)
      .run();
    return;
  }
  if (!/^[A-Za-z0-9_.-]{1,191}$/.test(field)) {
    throw new PermanentChannelError("Invalid custom field key");
  }
  const fields = parseJsonRecord(job.custom_fields);
  fields[field] = value;
  await createDatabase(env.DB)
    .prepare(
      "UPDATE contacts SET custom_fields = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
    )
    .bind(JSON.stringify(fields), new Date().toISOString(), job.workspace_id, job.recipient_id)
    .run();
}

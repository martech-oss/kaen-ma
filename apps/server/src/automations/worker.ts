import { PermanentChannelError } from "@kaenma/channels";
import { computeDueAt, outgoingEdges } from "@kaenma/core";
import {
  AutomationEngineRepository,
  createDatabase,
  type AutomationContactColumn,
  type AutomationJobRow,
} from "@kaenma/database";
import {
  automationDefinitionSchema,
  type AutomationDefinition,
  type AutomationEdge,
  type AutomationNode,
} from "@kaenma/orpc";

import { recordContactEvent } from "../contacts/event-service";
import { type RuntimeEnv } from "../env";
import { createEmailDelivery, createWebhookDelivery } from "../messaging/delivery-worker";
import { parseJsonRecord } from "../platform/values";
import { primitiveString } from "../platform/values";

export type { AutomationJobRow };

export async function processAutomationJob(
  jobId: string,
  leaseId: string,
  env: RuntimeEnv,
): Promise<void> {
  const engine = new AutomationEngineRepository(createDatabase(env.DB));
  const job = await engine.findJobForProcessing(jobId, leaseId);
  if (!job) return;
  const started = await engine.startLeasedJob(jobId, leaseId, new Date().toISOString());
  if (!started && job.status !== "running") return;

  try {
    const definition = automationDefinitionSchema.parse(JSON.parse(job.graph));
    const node = definition.nodes.find((candidate) => candidate.id === job.node_id);
    if (!node) throw new PermanentChannelError(`Automation node ${job.node_id} is missing`);
    const result = await executeNode(node, definition, job, env);
    if (result.waitUntil) {
      await engine.parkJobUntil(job.id, leaseId, {
        dueAt: result.waitUntil,
        payload: JSON.stringify({ waiting: true }),
        now: new Date().toISOString(),
      });
      return;
    }
    await finishNode(job, leaseId, definition, result.branch, env);
  } catch (error) {
    await engine.releaseJobForRetry(
      job.id,
      leaseId,
      error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      new Date().toISOString(),
    );
    throw error;
  }
}

export async function executeNode(
  node: AutomationNode,
  definition: AutomationDefinition,
  job: AutomationJobRow,
  env: RuntimeEnv,
): Promise<{ branch?: AutomationEdge["branch"]; waitUntil?: string }> {
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
  const database = createDatabase(env.DB);
  const engine = new AutomationEngineRepository(database);
  if (node.type === "decision") {
    const eventType = {
      opened: "email_opened",
      clicked: "email_clicked",
      replied: "email_replied",
      page_viewed: "page_viewed",
      form_submitted: "form_submitted",
      custom_event: "custom_event",
    }[node.config.event];
    const found = await engine.hasContactEventSince(
      job.workspace_id,
      job.contact_id,
      eventType,
      job.entered_at,
      node.config.resourceId ?? null,
    );
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
      await engine.addContactTag(job.workspace_id, job.contact_id, action.tagId, now);
      break;
    case "remove_tag":
      await engine.removeContactTag(job.workspace_id, job.contact_id, action.tagId);
      break;
    case "add_segment":
      if (
        await engine.addAutomationSegmentMembership(
          job.workspace_id,
          action.segmentId,
          job.contact_id,
          now,
        )
      ) {
        await recordContactEvent(database, {
          workspaceId: job.workspace_id,
          contactId: job.contact_id,
          type: "segment_joined",
          resourceType: "segment",
          resourceId: action.segmentId,
        });
      }
      break;
    case "remove_segment":
      await engine.removeSegmentMembership(job.workspace_id, action.segmentId, job.contact_id);
      break;
    case "change_score":
      await engine.adjustContactScoreForEnrollment(
        job.workspace_id,
        job.contact_id,
        job.enrollment_id,
        action.amount,
        now,
      );
      break;
    case "update_field":
      await updateContactField(job, action.field, action.value, env);
      break;
  }
  return { branch: "next" };
}

export async function finishNode(
  job: AutomationJobRow,
  leaseId: string,
  definition: AutomationDefinition,
  branch: AutomationEdge["branch"] | undefined,
  env: RuntimeEnv,
): Promise<void> {
  const engine = new AutomationEngineRepository(createDatabase(env.DB));
  const next = outgoingEdges(definition, job.node_id, branch ?? "next")[0];
  const now = new Date().toISOString();
  if (!next) {
    await engine.completeJobClosingEnrollment(job, leaseId, now);
    return;
  }
  await engine.completeJobAdvancingEnrollment(job, leaseId, next.target, now);
}

export async function evaluateCondition(
  node: Extract<AutomationNode, { type: "condition" }>,
  job: AutomationJobRow,
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
    const engine = new AutomationEngineRepository(createDatabase(env.DB));
    const tagged = await engine.contactHasTagWithSlug(
      job.workspace_id,
      job.contact_id,
      String(node.config.value ?? ""),
    );
    return compare(tagged, node.config.operator, true);
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
  job: AutomationJobRow,
  field: string,
  value: unknown,
  env: RuntimeEnv,
): Promise<void> {
  const engine = new AutomationEngineRepository(createDatabase(env.DB));
  const columns: Record<string, AutomationContactColumn> = {
    first_name: "first_name",
    last_name: "last_name",
    phone: "phone",
    stage: "stage",
    external_id: "external_id",
  };
  const column = columns[field];
  if (column) {
    await engine.updateContactColumn(
      job.workspace_id,
      job.contact_id,
      column,
      primitiveString(value),
      new Date().toISOString(),
    );
    return;
  }
  if (!/^[A-Za-z0-9_.-]{1,191}$/.test(field)) {
    throw new PermanentChannelError("Invalid custom field key");
  }
  const fields = parseJsonRecord(job.custom_fields);
  fields[field] = value;
  await engine.replaceContactCustomFields(
    job.workspace_id,
    job.contact_id,
    JSON.stringify(fields),
    new Date().toISOString(),
  );
}

import type { DealRow, DealStageRow, DealTaskRow } from "@openengage/database";
import type { DealSummary, DealTask } from "@openengage/orpc";

export function serializeStage(
  stage: Pick<DealStageRow, "id" | "name" | "color" | "position" | "probability">,
) {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    position: Number(stage.position),
    probability: Number(stage.probability),
  };
}

export function serializeDeal(row: DealRow): DealSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageColor: row.stage_color,
    stagePosition: Number(row.stage_position),
    stageProbability: Number(row.stage_probability),
    name: row.name,
    value: Number(row.value),
    currency: row.currency,
    status: row.status,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    contactId: row.contact_id,
    contactEmail: row.contact_email,
    contactFirstName: row.contact_first_name,
    contactLastName: row.contact_last_name,
    companyId: row.company_id,
    companyName: row.company_name,
    expectedCloseDate: row.expected_close_date,
    description: row.description,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openTaskCount: Number(row.open_task_count),
    nextTaskAt: row.next_task_at,
  };
}

export function serializeTask(row: DealTaskRow): DealTask {
  return {
    id: row.id,
    dealId: row.deal_id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

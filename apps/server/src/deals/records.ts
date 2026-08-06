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
    workspaceId: row.workspaceId,
    pipelineId: row.pipelineId,
    pipelineName: row.pipelineName,
    stageId: row.stageId,
    stageName: row.stageName,
    stageColor: row.stageColor,
    stagePosition: Number(row.stagePosition),
    stageProbability: Number(row.stageProbability),
    name: row.name,
    value: Number(row.value),
    currency: row.currency,
    status: row.status,
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
    contactId: row.contactId,
    contactEmail: row.contactEmail,
    contactFirstName: row.contactFirstName,
    contactLastName: row.contactLastName,
    companyId: row.companyId,
    companyName: row.companyName,
    expectedCloseDate: row.expectedCloseDate,
    description: row.description,
    wonAt: row.wonAt,
    lostAt: row.lostAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    openTaskCount: Number(row.openTaskCount),
    nextTaskAt: row.nextTaskAt,
  };
}

export function serializeTask(row: DealTaskRow): DealTask {
  return {
    id: row.id,
    dealId: row.dealId,
    type: row.type,
    title: row.title,
    notes: row.notes,
    dueAt: row.dueAt,
    status: row.status,
    assignedUserId: row.assignedUserId,
    assigneeName: row.assigneeName,
    assigneeEmail: row.assigneeEmail,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

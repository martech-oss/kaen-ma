import { rpc } from "@/rpc";
import type {
  DealCreate,
  DealStatus,
  DealTaskCreate,
  DealTaskStatus,
  DealTaskType,
  DealTaskUpdate,
  DealUpdate,
} from "@kaenma/shared/deals";

export type {
  DealCreate,
  DealStatus,
  DealTaskCreate,
  DealTaskStatus,
  DealTaskType,
  DealTaskUpdate,
};

export interface DealStage {
  id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
}

export interface DealPipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: DealStage[];
}

export interface DealContactOption {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface DealAccountOption {
  id: string;
  name: string;
  domain: string | null;
}

export interface DealMemberOption {
  id: string;
  name: string;
  email: string;
}

export interface DealOptions {
  pipelines: DealPipeline[];
  contacts: DealContactOption[];
  accounts: DealAccountOption[];
  members: DealMemberOption[];
}

export interface DealSummary {
  id: string;
  workspaceId: string;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  stagePosition: number;
  stageProbability: number;
  name: string;
  value: number;
  currency: string;
  status: DealStatus;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  contactId: string | null;
  contactEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  accountId: string | null;
  accountName: string | null;
  expectedCloseDate: string | null;
  description: string;
  wonAt: string | null;
  lostAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  openTaskCount: number;
  nextTaskAt: string | null;
}

export interface DealListSummary {
  openCount: number;
  openValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
}

export interface DealListData {
  items: DealSummary[];
  summary: DealListSummary;
}

export interface DealTask {
  id: string;
  dealId: string;
  type: DealTaskType;
  title: string;
  notes: string;
  dueAt: string | null;
  status: DealTaskStatus;
  assignedUserId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealDetailData {
  deal: DealSummary;
  tasks: DealTask[];
}

export interface DealSearch {
  pipelineId: string;
  status: DealStatus | "all";
  q: string;
}

export const dealSearchDefaults: DealSearch = {
  pipelineId: "",
  status: "open",
  q: "",
};

export async function loadDealOptions(signal?: AbortSignal): Promise<DealOptions> {
  const response = await rpc<DealOptions>("/deal-options", {
    signal: signal ?? null,
  });
  return response.data;
}

export async function loadDeals(search: DealSearch, signal?: AbortSignal): Promise<DealListData> {
  const params = new URLSearchParams({ status: search.status });
  if (search.pipelineId) params.set("pipelineId", search.pipelineId);
  if (search.q.trim()) params.set("q", search.q.trim());
  const response = await rpc<DealListData>(`/deals?${params.toString()}`, {
    signal: signal ?? null,
  });
  return response.data;
}

export async function loadDealsWorkspace(
  search: DealSearch,
  signal?: AbortSignal,
): Promise<{ deals: DealListData; options: DealOptions }> {
  const options = await loadDealOptions(signal);
  const pipelineId =
    search.pipelineId ||
    options.pipelines.find((pipeline) => pipeline.isDefault)?.id ||
    options.pipelines[0]?.id ||
    "";
  const deals = await loadDeals({ ...search, pipelineId }, signal);
  return { deals, options };
}

export async function loadDealDetailWorkspace(
  dealId: string,
  signal?: AbortSignal,
): Promise<{ detail: DealDetailData; options: DealOptions }> {
  const [detail, options] = await Promise.all([
    rpc<DealDetailData>(`/deals/${dealId}`, { signal: signal ?? null }),
    loadDealOptions(signal),
  ]);
  return { detail: detail.data, options };
}

export async function createDeal(input: DealCreate): Promise<DealSummary> {
  const response = await rpc<DealSummary>("/deals", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateDeal(dealId: string, input: DealUpdate): Promise<DealSummary> {
  const response = await rpc<DealSummary>(`/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function moveDeal(dealId: string, stageId: string): Promise<DealSummary> {
  const response = await rpc<DealSummary>(`/deals/${dealId}/move`, {
    method: "POST",
    body: JSON.stringify({ stageId }),
  });
  return response.data;
}

export async function archiveDeal(dealId: string): Promise<void> {
  await rpc(`/deals/${dealId}/archive`, { method: "POST" });
}

export async function createDealTask(dealId: string, input: DealTaskCreate): Promise<DealTask> {
  const response = await rpc<DealTask>(`/deals/${dealId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateDealTask(
  dealId: string,
  taskId: string,
  input: DealTaskUpdate,
): Promise<DealTask> {
  const response = await rpc<DealTask>(`/deals/${dealId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function deleteDealTask(dealId: string, taskId: string): Promise<void> {
  await rpc(`/deals/${dealId}/tasks/${taskId}`, { method: "DELETE" });
}

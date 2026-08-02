import { orpc } from "@/lib/orpc";
import type {
  DealCreate,
  DealDetailData,
  DealListData,
  DealOptions,
  DealStage,
  DealStatus,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskStatus,
  DealTaskType,
  DealTaskUpdate,
  DealUpdate,
} from "@kaenma/orpc";

export type {
  DealCreate,
  DealDetailData,
  DealListData,
  DealOptions,
  DealStage,
  DealStatus,
  DealSummary,
  DealTask,
  DealTaskCreate,
  DealTaskStatus,
  DealTaskType,
  DealTaskUpdate,
};

export type DealContactOption = DealOptions["contacts"][number];
export type DealAccountOption = DealOptions["companies"][number];
export type DealMemberOption = DealOptions["members"][number];
export type DealPipeline = DealOptions["pipelines"][number];
export type DealListSummary = DealListData["summary"];

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

export function loadDealOptions(signal?: AbortSignal): Promise<DealOptions> {
  return orpc.deals.options(undefined, signal ? { signal } : undefined);
}

export function loadDeals(search: DealSearch, signal?: AbortSignal): Promise<DealListData> {
  return orpc.deals.list(
    {
      status: search.status,
      ...(search.pipelineId ? { pipelineId: search.pipelineId } : {}),
      ...(search.q.trim() ? { q: search.q.trim() } : {}),
    },
    signal ? { signal } : undefined,
  );
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
  const request = signal ? { signal } : undefined;
  const [detail, options] = await Promise.all([
    orpc.deals.get({ id: dealId }, request),
    loadDealOptions(signal),
  ]);
  return { detail, options };
}

export function createDeal(input: DealCreate): Promise<DealSummary> {
  return orpc.deals.create(input);
}

export function updateDeal(dealId: string, input: DealUpdate): Promise<DealSummary> {
  return orpc.deals.update({ id: dealId, ...input });
}

export function moveDeal(dealId: string, stageId: string): Promise<DealSummary> {
  return orpc.deals.move({ id: dealId, stageId });
}

export async function archiveDeal(dealId: string): Promise<void> {
  await orpc.deals.archive({ id: dealId });
}

export function createDealTask(dealId: string, input: DealTaskCreate): Promise<DealTask> {
  return orpc.deals.createTask({ dealId, ...input });
}

export function updateDealTask(
  dealId: string,
  taskId: string,
  input: DealTaskUpdate,
): Promise<DealTask> {
  return orpc.deals.updateTask({ dealId, taskId, ...input });
}

export async function deleteDealTask(dealId: string, taskId: string): Promise<void> {
  await orpc.deals.deleteTask({ dealId, taskId });
}

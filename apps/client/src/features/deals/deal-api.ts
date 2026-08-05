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
} from "@openengage/orpc";

import { orpcQuery } from "@/lib/orpc";

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
export type DealCompanyOption = DealOptions["companies"][number];
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

export function dealOptionsQueryOptions() {
  return orpcQuery.deals.options.queryOptions();
}

export function dealsQueryOptions(search: DealSearch) {
  return orpcQuery.deals.list.queryOptions({
    input: {
      status: search.status,
      ...(search.pipelineId ? { pipelineId: search.pipelineId } : {}),
      ...(search.q.trim() ? { q: search.q.trim() } : {}),
    },
  });
}

export function dealDetailQueryOptions(dealId: string) {
  return orpcQuery.deals.get.queryOptions({ input: { id: dealId } });
}

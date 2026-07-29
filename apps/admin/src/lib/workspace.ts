import { orpcQuery } from "@/lib/orpc";

export type { Workspace } from "@kaenma/api-contract";

export function workspaceQueryOptions() {
  return orpcQuery.workspace.get.queryOptions();
}

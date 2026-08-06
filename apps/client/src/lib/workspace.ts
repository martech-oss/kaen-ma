import { orpcQuery } from "@/lib/orpc";

export type { Workspace } from "@openengage/core/workspaces";

export function workspaceQueryOptions() {
  return orpcQuery.workspace.get.queryOptions();
}

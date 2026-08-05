import { orpcQuery } from "@/lib/orpc";

export type { Workspace } from "@openengage/orpc";

export function workspaceQueryOptions() {
  return orpcQuery.workspace.get.queryOptions();
}

import { orpcQuery } from "@/lib/orpc";

export type { Workspace } from "@kaenma/orpc";

export function workspaceQueryOptions() {
  return orpcQuery.workspace.get.queryOptions();
}

import { orpcQuery } from "@/lib/orpc";

export type { Workspace } from "@kaenma/contract";

export function workspaceQueryOptions() {
  return orpcQuery.workspace.get.queryOptions();
}

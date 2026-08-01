import type { WorkspaceRole } from "@kaenma/orpc";

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 0,
  analyst: 1,
  marketer: 2,
  admin: 3,
  owner: 4,
};

export function hasWorkspaceRole(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return roleRank[role] >= roleRank[minimum];
}

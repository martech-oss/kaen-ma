import { orpc } from "@/lib/orpc";

export function createWorkspaceApiKey() {
  return orpc.workspace.createApiKey({
    name: "Admin generated key",
    role: "marketer",
  });
}

import { ApiKeyRepository, uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext, WorkspaceRole } from "@kaenma/orpc";

import { randomIdentifier, randomString, sha256Hex } from "../platform/crypto";

export async function createApiKey(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { name: string; role: WorkspaceRole; expiresAt?: string | undefined },
): Promise<{ id: string; token: string; prefix: string }> {
  const prefix = randomIdentifier(12);
  const token = `kaenma_${prefix}_${randomString(40)}`;
  const id = uuidv7();
  await new ApiKeyRepository(database).create({
    id,
    workspaceId: workspace.workspaceId,
    createdByUserId: workspace.userId,
    name: input.name,
    prefix,
    keyHash: await sha256Hex(token),
    role: input.role,
    expiresAt: input.expiresAt ?? null,
    createdAt: new Date().toISOString(),
  });
  return { id, token, prefix };
}

import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { WorkspaceContext, WorkspaceRole } from "@kaenma/shared";

import { randomIdentifier, randomString, sha256Hex } from "../platform/crypto";

export async function createApiKey(
  database: KaenmaDatabase,
  workspace: WorkspaceContext,
  input: { name: string; role: WorkspaceRole; expiresAt?: string | undefined },
): Promise<{ id: string; token: string; prefix: string }> {
  const prefix = randomIdentifier(12);
  const token = `kaenma_${prefix}_${randomString(40)}`;
  const id = uuidv7();
  await database
    .prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      workspace.workspaceId,
      workspace.userId,
      input.name,
      prefix,
      await sha256Hex(token),
      input.role,
      input.expiresAt ?? null,
      new Date().toISOString(),
    )
    .run();
  return { id, token, prefix };
}

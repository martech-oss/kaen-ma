import { and, eq, gt } from "drizzle-orm";
import * as z from "zod";

import { idempotencyKeys, type OpenEngageDatabase } from "@openengage/database";

const confirmationLifetimeMs = 5 * 60_000;
const confirmationPayloadSchema = z.object({
  automationId: z.string().min(1),
  contactId: z.string().min(1),
});

export type AutomationConfirmation = z.infer<typeof confirmationPayloadSchema>;

export async function createAutomationConfirmation(
  database: OpenEngageDatabase,
  workspaceId: string,
  apiKeyId: string,
  payload: AutomationConfirmation,
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + confirmationLifetimeMs).toISOString();
  await database.orm.insert(idempotencyKeys).values({
    workspaceId,
    scope: confirmationScope(apiKeyId),
    idempotencyKey: token,
    responseBody: JSON.stringify(payload),
    createdAt: now.toISOString(),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function consumeAutomationConfirmation(
  database: OpenEngageDatabase,
  workspaceId: string,
  apiKeyId: string,
  token: string,
): Promise<AutomationConfirmation | null> {
  const [row] = await database.orm
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.workspaceId, workspaceId),
        eq(idempotencyKeys.scope, confirmationScope(apiKeyId)),
        eq(idempotencyKeys.idempotencyKey, token),
        gt(idempotencyKeys.expiresAt, new Date().toISOString()),
      ),
    )
    .returning({ payload: idempotencyKeys.responseBody });
  if (!row?.payload) return null;
  try {
    const parsed = confirmationPayloadSchema.safeParse(JSON.parse(row.payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function confirmationScope(apiKeyId: string): string {
  return `mcp:automation-enrollment:${apiKeyId}`;
}

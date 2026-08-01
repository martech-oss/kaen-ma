import { type AppEnvironment } from "../env";
import { createSignedToken } from "../platform/crypto";

export async function buildReplyAddress(
  env: AppEnvironment["Bindings"],
  workspaceId: string,
  deliveryId: string,
  contactId: string,
): Promise<string> {
  const token = await createSignedToken(env.TRACKING_SIGNING_SECRET, {
    workspaceId,
    resourceId: deliveryId,
    contactId,
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    purpose: "reply",
  });
  return `r+${token}@${env.REPLY_DOMAIN}`;
}

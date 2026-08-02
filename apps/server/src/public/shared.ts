import { and, eq } from "drizzle-orm";

import { type KaenmaDatabase, organization, siteTrackingSettings } from "@kaenma/database";

import { sha256Hex } from "../platform/crypto";

export async function loadPublicTrackingWorkspace(
  database: KaenmaDatabase,
  workspaceSlug: string,
): Promise<{ id: string; allowedDomains: string[] } | null> {
  const [row] = await database.orm
    .select({ id: organization.id, allowedDomains: siteTrackingSettings.allowedDomains })
    .from(organization)
    .innerJoin(siteTrackingSettings, eq(siteTrackingSettings.workspaceId, organization.id))
    .where(and(eq(organization.slug, workspaceSlug), eq(siteTrackingSettings.enabled, true)))
    .limit(1);
  if (!row) return null;
  try {
    return {
      id: row.id,
      allowedDomains: JSON.parse(row.allowedDomains) as string[],
    };
  } catch {
    return null;
  }
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export async function hashIp(value?: string): Promise<string | null> {
  return value ? sha256Hex(value) : null;
}

import type { KaenmaDatabase } from "@kaenma/database";

import { sha256Hex } from "../crypto";

export async function loadPublicTrackingWorkspace(
  database: KaenmaDatabase,
  workspaceSlug: string,
): Promise<{ id: string; allowedDomains: string[] } | null> {
  const row = await database
    .prepare(
      `SELECT o.id, sts.allowed_domains
     FROM organization o JOIN site_tracking_settings sts
       ON sts.workspace_id = o.id
     WHERE o.slug = ? AND sts.enabled = 1`,
    )
    .bind(workspaceSlug)
    .first<{ id: string; allowed_domains: string }>();
  if (!row) return null;
  try {
    return {
      id: row.id,
      allowedDomains: JSON.parse(row.allowed_domains) as string[],
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

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@kaenma/database";
import { contract } from "@kaenma/orpc";

import { sha256Hex } from "../src/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

/**
 * The five report output schemas are transcriptions of what the query functions
 * build. tsc only checks they are structurally compatible; oRPC validates the
 * real payload at runtime and is stricter (.int() rejects a float, a missing key
 * fails). This drives all five against seeded data so a wrong schema fails here
 * rather than in the browser.
 */
describe("reports over oRPC", () => {
  it("validates every report's output schema against real data", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const token = "kaenma_reportkey001_abcdefghijklmnopqrstuvwx";
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'Report Owner', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Report Workspace', ?, ?, 'Asia/Tokyo')`,
      ).bind(workspaceId, `report-${workspaceId}`, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'report test', 'reportkey001', ?, 'owner', ?)`,
      ).bind(uuidv7(), workspaceId, userId, await sha256Hex(token), now),
    ]);

    const client = createORPCClient(
      new RPCLink({
        url: "http://localhost:8787/api/rpc",
        headers: { authorization: `Bearer ${token}` },
        fetch: (request) => exports.default.fetch(request),
      }),
    ) as ContractRouterClient<typeof contract>;

    // give the reports something to count
    await client.contacts.create({ email: "r@example.com", stage: "lead", customFields: {} });

    // reportDateRangeSchema caps the span at 366 days, and the seeded contact is
    // created now, so the window has to end today.
    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 29);
    const range = {
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    };
    const [contacts, automations, emails, deals, site] = await Promise.all([
      client.reports.contacts(range),
      client.reports.automations(range),
      client.reports.emails(range),
      client.reports.deals({ ...range, currency: "JPY" }),
      client.reports.site(range),
    ]);

    expect(contacts.category).toBe("contacts");
    expect(contacts.summary.totalContacts).toBe(1);
    expect(contacts.range).toEqual(range);
    expect(automations.category).toBe("automations");
    expect(emails.category).toBe("emails");
    expect(deals.category).toBe("deals");
    expect(deals.currency).toBe("JPY");
    expect(site.category).toBe("site");
    expect(site.notes.messageMetrics).toEqual(expect.any(String));
  });

  it("rejects a report request below analyst", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const token = "kaenma_reportkey002_abcdefghijklmnopqrstuvwx";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'Viewer', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Viewer Workspace', ?, ?, 'UTC')`,
      ).bind(workspaceId, `viewer-${workspaceId}`, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'viewer', 'reportkey002', ?, 'viewer', ?)`,
      ).bind(uuidv7(), workspaceId, userId, await sha256Hex(token), new Date().toISOString()),
    ]);
    const client = createORPCClient(
      new RPCLink({
        url: "http://localhost:8787/api/rpc",
        headers: { authorization: `Bearer ${token}` },
        fetch: (request) => exports.default.fetch(request),
      }),
    ) as ContractRouterClient<typeof contract>;

    await expect(
      client.reports.contacts({ from: "2024-01-01", to: "2024-01-31" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

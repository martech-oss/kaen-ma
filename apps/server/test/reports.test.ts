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

describe("Reporting", () => {
  it("aggregates contacts, automations, emails, deals, and site activity", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const apiKeyId = uuidv7();
    const contactId = uuidv7();
    const archivedContactId = uuidv7();
    const campaignId = uuidv7();
    const campaignVersionId = uuidv7();
    const enrollmentId = uuidv7();
    const deliveryId = uuidv7();
    const pipelineId = uuidv7();
    const stageId = uuidv7();
    const wonDealId = uuidv7();
    const openDealId = uuidv7();
    const formId = uuidv7();
    const prefix = "reportskey01";
    const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
    const at = "2026-07-15T03:00:00.000Z";
    const completedAt = "2026-07-20T03:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user
         (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'Report Analyst', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Report Workspace', ?, ?, 'Asia/Tokyo')`,
      ).bind(workspaceId, `reports-${workspaceId}`, Date.now()),
      env.DB.prepare(
        `INSERT INTO member
         (id, organization_id, user_id, role, created_at)
         VALUES (?, ?, ?, 'analyst', ?)`,
      ).bind(uuidv7(), workspaceId, userId, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'Reports test', ?, ?, 'analyst', ?)`,
      ).bind(apiKeyId, workspaceId, userId, prefix, await sha256Hex(token), at),
      env.DB.prepare(
        `INSERT INTO contacts
         (id, workspace_id, email, stage, score, status, custom_fields, created_at, updated_at)
         VALUES (?, ?, 'active@example.com', 'lead', 10, 'active', '{}', ?, ?)`,
      ).bind(contactId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO contacts
         (id, workspace_id, email, stage, score, status, custom_fields,
          created_at, updated_at, archived_at)
         VALUES (?, ?, 'archived@example.com', 'lead', 0, 'archived', '{}', ?, ?, ?)`,
      ).bind(archivedContactId, workspaceId, at, completedAt, completedAt),
      env.DB.prepare(
        `INSERT INTO campaigns
         (id, workspace_id, name, description, status, created_at, updated_at)
         VALUES (?, ?, 'Welcome flow', '', 'active', ?, ?)`,
      ).bind(campaignId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO campaign_versions
         (id, workspace_id, campaign_id, version, status, timezone, graph, published_at, created_at)
         VALUES (?, ?, ?, 1, 'published', 'Asia/Tokyo', '{"nodes":[],"edges":[]}', ?, ?)`,
      ).bind(campaignVersionId, workspaceId, campaignId, at, at),
      env.DB.prepare(
        `INSERT INTO campaign_enrollments
         (id, workspace_id, campaign_id, campaign_version_id, contact_id, status,
          entered_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      ).bind(
        enrollmentId,
        workspaceId,
        campaignId,
        campaignVersionId,
        contactId,
        at,
        completedAt,
        completedAt,
      ),
      env.DB.prepare(
        `INSERT INTO deliveries
         (id, workspace_id, contact_id, enrollment_id, channel, purpose, provider,
          recipient, idempotency_key, payload, status, provider_message_id,
          attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'email', 'marketing', 'resend', 'active@example.com',
                 ?, '{}', 'delivered', ?, 1, ?, ?)`,
      ).bind(
        deliveryId,
        workspaceId,
        contactId,
        enrollmentId,
        `report-${deliveryId}`,
        `provider-${deliveryId}`,
        at,
        completedAt,
      ),
      ...["delivered", "opened", "clicked"].map((type, index) =>
        env.DB.prepare(
          `INSERT INTO delivery_events
           (id, workspace_id, delivery_id, provider, provider_event_id,
            provider_message_id, type, occurred_at, metadata, created_at)
           VALUES (?, ?, ?, 'resend', ?, ?, ?, ?, '{}', ?)`,
        ).bind(
          uuidv7(),
          workspaceId,
          deliveryId,
          `${deliveryId}-${type}`,
          `provider-${deliveryId}`,
          type,
          `2026-07-${String(16 + index).padStart(2, "0")}T03:00:00.000Z`,
          at,
        ),
      ),
      env.DB.prepare(
        `INSERT INTO deal_pipelines
         (id, workspace_id, name, is_default, created_at, updated_at)
         VALUES (?, ?, 'Sales', 1, ?, ?)`,
      ).bind(pipelineId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO deal_stages
         (id, workspace_id, pipeline_id, name, color, position, probability, created_at, updated_at)
         VALUES (?, ?, ?, 'Proposal', '#8b5cf6', 0, 50, ?, ?)`,
      ).bind(stageId, workspaceId, pipelineId, at, at),
      env.DB.prepare(
        `INSERT INTO deals
         (id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
          owner_user_id, description, won_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Won deal', 100000, 'JPY', 'won', ?, '', ?, ?, ?)`,
      ).bind(wonDealId, workspaceId, pipelineId, stageId, userId, completedAt, at, completedAt),
      env.DB.prepare(
        `INSERT INTO deals
         (id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
          owner_user_id, expected_close_date, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Open deal', 200000, 'JPY', 'open', ?,
                 '2026-07-28', '', ?, ?)`,
      ).bind(openDealId, workspaceId, pipelineId, stageId, userId, at, at),
      env.DB.prepare(
        `INSERT INTO deal_tasks
         (id, workspace_id, deal_id, type, title, notes, due_at, status,
          assigned_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'call', 'Follow up', '', '2026-07-01T00:00:00.000Z',
                 'open', ?, ?, ?)`,
      ).bind(uuidv7(), workspaceId, openDealId, userId, at, at),
      env.DB.prepare(
        `INSERT INTO forms
         (id, workspace_id, name, slug, status, version, definition,
          allowed_domains, turnstile_enabled, success_message, created_at, updated_at)
         VALUES (?, ?, 'Newsletter', 'newsletter', 'published', 1, '{}',
                 '[]', 0, 'Thanks', ?, ?)`,
      ).bind(formId, workspaceId, at, at),
      env.DB.prepare(
        `INSERT INTO form_submissions
         (id, workspace_id, form_id, contact_id, idempotency_key, payload, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?)`,
      ).bind(uuidv7(), workspaceId, formId, contactId, `form-${uuidv7()}`, at),
      env.DB.prepare(
        `INSERT INTO contact_events
         (id, workspace_id, contact_id, visitor_id, type, resource_type,
          resource_id, properties, occurred_at, created_at)
         VALUES (?, ?, ?, 'visitor-1', 'page_viewed', 'page',
                 'https://example.com/pricing', '{}', ?, ?)`,
      ).bind(uuidv7(), workspaceId, contactId, at, at),
      env.DB.prepare(
        `INSERT INTO contact_events
         (id, workspace_id, contact_id, visitor_id, type, resource_type,
          resource_id, properties, occurred_at, created_at)
         VALUES (?, ?, ?, 'visitor-1', 'page_viewed', 'page',
                 'https://example.com/pricing', '{}', ?, ?)`,
      ).bind(uuidv7(), workspaceId, contactId, completedAt, completedAt),
      env.DB.prepare(
        `INSERT INTO site_messages
         (id, workspace_id, name, status, headline, body, cta_label,
          page_pattern, impression_count, click_count, created_at, updated_at)
         VALUES (?, ?, 'Pricing CTA', 'published', 'Talk to sales', '', 'Contact',
                 '/pricing*', 10, 2, ?, ?)`,
      ).bind(uuidv7(), workspaceId, at, at),
    ]);

    const link = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      headers: { authorization: `Bearer ${token}` },
      fetch: (request) => exports.default.fetch(request),
    });
    const client: ContractRouterClient<typeof contract> = createORPCClient(link);
    const range = { from: "2026-07-01", to: "2026-07-31" };

    const contacts = await client.reports.contacts(range);
    expect(contacts).toMatchObject({
      category: "contacts",
      summary: {
        totalContacts: 2,
        activeContacts: 1,
        newContacts: 2,
        archivedContacts: 1,
      },
    });

    const automations = await client.reports.automations(range);
    expect(automations).toMatchObject({
      category: "automations",
      summary: {
        automationCount: 1,
        entries: 1,
        completions: 1,
        completionRate: 100,
        openRate: 100,
        clickRate: 100,
      },
    });

    const emails = await client.reports.emails(range);
    expect(emails).toMatchObject({
      category: "emails",
      summary: {
        sends: 1,
        delivered: 1,
        opens: 1,
        clicks: 1,
        deliveryRate: 100,
        openRate: 100,
      },
    });

    const deals = await client.reports.deals({ ...range, currency: "JPY" });
    expect(deals).toMatchObject({
      category: "deals",
      currency: "JPY",
      summary: {
        created: 2,
        won: 1,
        wonValue: 100_000,
        openCount: 1,
        openValue: 200_000,
        overdueTasks: 1,
      },
    });

    const site = await client.reports.site(range);
    expect(site).toMatchObject({
      category: "site",
      summary: {
        pageViews: 2,
        uniqueVisitors: 1,
        identifiedContacts: 1,
        identificationRate: 100,
        submissions: 1,
        messageImpressions: 10,
        messageClicks: 2,
      },
    });

    // The range refine (366-day cap) rejects during input validation; the
    // REST route surfaced this as 422 while oRPC reports BAD_REQUEST.
    await expect(
      client.reports.contacts({ from: "2025-01-01", to: "2026-07-31" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

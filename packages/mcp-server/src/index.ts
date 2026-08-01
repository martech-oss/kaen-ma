#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

import { createKaenmaClient } from "@kaenma/sdk";

const baseUrl = process.env["KAENMA_URL"];
const apiKey = process.env["KAENMA_API_KEY"];
if (!baseUrl || !apiKey) {
  process.stderr.write("KAENMA_URL and KAENMA_API_KEY are required\n");
  process.exit(1);
}

const client = createKaenmaClient({ baseUrl, apiKey });
const server = new McpServer({
  name: "kaenma",
  version: "0.1.0",
});

const pendingConfirmations = new Map<
  string,
  { campaignId: string; contactId: string; expiresAt: number }
>();

server.registerTool(
  "search_contacts",
  {
    title: "Search Kaenma contacts",
    description: "Search contacts in the API key's workspace. This tool is read-only.",
    inputSchema: {
      query: z.string().max(191).default(""),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  async ({ query, limit }) => {
    const result = await client.contacts.list({
      ...(query ? { query } : {}),
      limit,
    });
    return jsonResult(result);
  },
);

server.registerTool(
  "get_dashboard",
  {
    title: "Get Kaenma dashboard",
    description: "Read aggregate contact, campaign, and delivery health.",
    inputSchema: {},
  },
  async () => jsonResult(await client.operations.dashboard()),
);

server.registerTool(
  "list_campaigns",
  {
    title: "List Kaenma campaigns",
    description: "List campaigns and their current status. This tool is read-only.",
    inputSchema: {},
  },
  async () => jsonResult(await client.campaigns.list()),
);

server.registerTool(
  "get_campaign_draft",
  {
    title: "Get campaign draft",
    description: "Read the editable campaign graph.",
    inputSchema: { campaignId: z.string().min(1) },
  },
  async ({ campaignId }) => jsonResult(await client.campaigns.getDraft({ id: campaignId })),
);

server.registerTool(
  "prepare_campaign_enrollment",
  {
    title: "Prepare campaign enrollment",
    description:
      "Prepare, but do not execute, a contact enrollment. The returned confirmation token expires in five minutes.",
    inputSchema: {
      campaignId: z.string().min(1),
      contactId: z.string().min(1),
    },
  },
  async ({ campaignId, contactId }) => {
    const [campaign, contact] = await Promise.all([
      client.campaigns.getDraft({ id: campaignId }),
      client.contacts.get({ id: contactId }),
    ]);
    const confirmationToken = crypto.randomUUID();
    pendingConfirmations.set(confirmationToken, {
      campaignId,
      contactId,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return jsonResult({
      requiresConfirmation: true,
      confirmationToken,
      warning:
        "This enrollment can trigger real email or webhook delivery. Call confirm_campaign_enrollment with confirmation exactly CONFIRM SEND.",
      campaign: {
        id: campaignId,
        name: campaign.graph.name,
      },
      contact: {
        id: contact.id,
        email: contact.email,
      },
    });
  },
);

server.registerTool(
  "confirm_campaign_enrollment",
  {
    title: "Confirm campaign enrollment",
    description:
      "Enroll a contact only after explicit user confirmation. This can trigger a real delivery.",
    inputSchema: {
      confirmationToken: z.string().uuid(),
      confirmation: z.literal("CONFIRM SEND"),
    },
  },
  async ({ confirmationToken }) => {
    const pending = pendingConfirmations.get(confirmationToken);
    pendingConfirmations.delete(confirmationToken);
    if (!pending || pending.expiresAt < Date.now()) {
      return {
        content: [{ type: "text", text: "Confirmation token is invalid or expired." }],
        isError: true,
      };
    }
    const result = await client.campaigns.enroll({
      id: pending.campaignId,
      contactId: pending.contactId,
      sourceEventId: confirmationToken,
    });
    return jsonResult(result);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent:
      typeof value === "object" && value !== null ? (value as Record<string, unknown>) : { value },
  };
}

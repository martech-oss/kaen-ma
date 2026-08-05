#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOpenEngageClient } from "openengage";
import * as z from "zod";

const baseUrl = process.env["OPENENGAGE_URL"];
const apiKey = process.env["OPENENGAGE_API_KEY"];
if (!baseUrl || !apiKey) {
  process.stderr.write("OPENENGAGE_URL and OPENENGAGE_API_KEY are required\n");
  process.exit(1);
}

const client = createOpenEngageClient({ baseUrl, apiKey });
const server = new McpServer({
  name: "openengage",
  version: "0.1.0",
});

const pendingConfirmations = new Map<
  string,
  { automationId: string; contactId: string; expiresAt: number }
>();

server.registerTool(
  "search_contacts",
  {
    title: "Search OpenEngage contacts",
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
    title: "Get OpenEngage dashboard",
    description: "Read aggregate contact, automation, and delivery health.",
    inputSchema: {},
  },
  async () => jsonResult(await client.operations.dashboard()),
);

server.registerTool(
  "list_automations",
  {
    title: "List OpenEngage automations",
    description: "List automations and their current status. This tool is read-only.",
    inputSchema: {},
  },
  async () => jsonResult(await client.automations.list()),
);

server.registerTool(
  "get_automation_draft",
  {
    title: "Get automation draft",
    description: "Read the editable automation graph.",
    inputSchema: { automationId: z.string().min(1) },
  },
  async ({ automationId }) => jsonResult(await client.automations.getDraft({ id: automationId })),
);

server.registerTool(
  "prepare_automation_enrollment",
  {
    title: "Prepare automation enrollment",
    description:
      "Prepare, but do not execute, a contact enrollment. The returned confirmation token expires in five minutes.",
    inputSchema: {
      automationId: z.string().min(1),
      contactId: z.string().min(1),
    },
  },
  async ({ automationId, contactId }) => {
    const [automation, contact] = await Promise.all([
      client.automations.getDraft({ id: automationId }),
      client.contacts.get({ id: contactId }),
    ]);
    const confirmationToken = crypto.randomUUID();
    pendingConfirmations.set(confirmationToken, {
      automationId,
      contactId,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return jsonResult({
      requiresConfirmation: true,
      confirmationToken,
      warning:
        "This enrollment can trigger real email or webhook delivery. Call confirm_automation_enrollment with confirmation exactly CONFIRM SEND.",
      automation: {
        id: automationId,
        name: automation.graph.name,
      },
      contact: {
        id: contact.id,
        email: contact.email,
      },
    });
  },
);

server.registerTool(
  "confirm_automation_enrollment",
  {
    title: "Confirm automation enrollment",
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
    const result = await client.automations.enroll({
      id: pending.automationId,
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

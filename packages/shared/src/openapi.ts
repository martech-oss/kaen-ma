import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import * as z from "zod";

import { contactCreateSchema, contactSchema, contactUpdateSchema } from "./contacts";
import {
  dealCreateSchema,
  dealMoveSchema,
  dealTaskCreateSchema,
  dealTaskUpdateSchema,
  dealUpdateSchema,
} from "./deals";
import { campaignDefinitionSchema } from "./index";
import { reportCategorySchema, reportQuerySchema } from "./reports";
import { segmentFilterSchema } from "./segments";

extendZodWithOpenApi(z);

export function createOpenApiDocument(serverUrl: string): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  const contact = registry.register("Contact", contactSchema);
  const contactCreate = registry.register("ContactCreate", contactCreateSchema);
  const contactUpdate = registry.register("ContactUpdate", contactUpdateSchema);
  const segmentFilter = registry.register("SegmentFilter", segmentFilterSchema);
  const campaign = registry.register("CampaignDefinition", campaignDefinitionSchema);
  const dealCreate = registry.register("DealCreate", dealCreateSchema);
  const dealUpdate = registry.register("DealUpdate", dealUpdateSchema);
  const dealMove = registry.register("DealMove", dealMoveSchema);
  const dealTaskCreate = registry.register("DealTaskCreate", dealTaskCreateSchema);
  const dealTaskUpdate = registry.register("DealTaskUpdate", dealTaskUpdateSchema);
  const error = registry.register(
    "ApiError",
    z.object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        requestId: z.string().optional(),
        details: z.unknown().optional(),
      }),
    }),
  );
  const security = [{ workspaceApiKey: [] }];
  const errorResponses = {
    "401": {
      description: "Authentication failed",
      content: { "application/json": { schema: error } },
    },
    "403": {
      description: "Workspace access denied",
      content: { "application/json": { schema: error } },
    },
    "422": { description: "Validation failed", content: { "application/json": { schema: error } } },
  };

  registry.registerComponent("securitySchemes", "workspaceApiKey", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "kaenma_<prefix>_<secret>",
    description: "A hashed, workspace-scoped Kaenma API key.",
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/contacts",
    summary: "List contacts",
    security,
    request: {
      query: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        q: z.string().optional(),
      }),
    },
    responses: {
      "200": {
        description: "Cursor page",
        content: {
          "application/json": {
            schema: z.object({
              data: z.array(contact),
              meta: z.object({ nextCursor: z.string().optional() }).optional(),
            }),
          },
        },
      },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/contacts",
    summary: "Create a contact",
    security,
    request: {
      headers: z.object({ "idempotency-key": z.string().optional() }),
      body: { content: { "application/json": { schema: contactCreate } } },
    },
    responses: {
      "201": {
        description: "Created contact",
        content: { "application/json": { schema: z.object({ data: contact }) } },
      },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/api/v1/contacts/{id}",
    summary: "Update a contact",
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: contactUpdate } } },
    },
    responses: {
      "200": {
        description: "Updated contact",
        content: { "application/json": { schema: z.object({ data: contact }) } },
      },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/segments/preview",
    summary: "Preview a parameterized segment query",
    security,
    request: { body: { content: { "application/json": { schema: segmentFilter } } } },
    responses: {
      "200": { description: "At most 100 matching contacts" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/campaigns",
    summary: "Create a campaign draft",
    security,
    request: { body: { content: { "application/json": { schema: campaign } } } },
    responses: {
      "201": { description: "Campaign and draft version IDs" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/campaigns/{id}/publish",
    summary: "Validate and publish an immutable campaign version",
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      "200": { description: "Published and next draft version IDs" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/deals",
    summary: "List deals in a pipeline",
    security,
    request: {
      query: z.object({
        pipelineId: z.string().optional(),
        status: z.enum(["open", "won", "lost", "all"]).optional(),
        q: z.string().optional(),
      }),
    },
    responses: {
      "200": { description: "Deals and pipeline summary" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/deals",
    summary: "Create a deal",
    security,
    request: { body: { content: { "application/json": { schema: dealCreate } } } },
    responses: {
      "201": { description: "Created deal" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/api/v1/deals/{id}",
    summary: "Update a deal",
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: dealUpdate } } },
    },
    responses: {
      "200": { description: "Updated deal" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/deals/{id}/move",
    summary: "Move a deal to another stage",
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: dealMove } } },
    },
    responses: {
      "200": { description: "Moved deal" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/v1/deals/{id}/tasks",
    summary: "Create a deal task",
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: dealTaskCreate } } },
    },
    responses: {
      "201": { description: "Created deal task" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "patch",
    path: "/api/v1/deals/{dealId}/tasks/{taskId}",
    summary: "Update a deal task",
    security,
    request: {
      params: z.object({ dealId: z.string(), taskId: z.string() }),
      body: { content: { "application/json": { schema: dealTaskUpdate } } },
    },
    responses: {
      "200": { description: "Updated deal task" },
      ...errorResponses,
    },
  });
  registry.registerPath({
    method: "get",
    path: "/api/v1/reports/{category}",
    summary: "Get a workspace performance report",
    security,
    request: {
      params: z.object({ category: reportCategorySchema }),
      query: reportQuerySchema,
    },
    responses: {
      "200": {
        description: "Contacts, automations, email, deals, or site report",
      },
      ...errorResponses,
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Kaenma API",
      version: "0.1.0",
      description: "Cloudflare-native marketing automation REST API.",
    },
    servers: [{ url: serverUrl }],
  }) as unknown as Record<string, unknown>;
}

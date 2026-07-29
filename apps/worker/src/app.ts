import { compileSegmentFilter, validateCampaign } from "@kaenma/core";
import { ResendEmailAdapter } from "@kaenma/channels";
import {
  WorkspaceRepository,
  uuidv7,
  writeAuditLog,
} from "@kaenma/db";
import { renderContent } from "@kaenma/email-renderer";
import {
  accountCreateSchema,
  accountUpdateSchema,
  campaignDefinitionSchema,
  contactCreateSchema,
  contactUpdateSchema,
  contentDocumentSchema,
  messagePurposeSchema,
  segmentFilterSchema,
  workspaceRoleSchema,
  type CampaignDefinition,
  type Contact,
} from "@kaenma/shared";
import { createOpenApiDocument } from "@kaenma/shared/openapi";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createAuth } from "./auth";
import {
  createSignedToken,
  decryptCredentials,
  encryptCredentials,
  sha256Hex,
  verifySignedToken,
} from "./crypto";
import type { AppEnvironment } from "./env";
import {
  apiError,
  requestContext,
  requireRole,
  requireWorkspace,
} from "./middleware";

const app = new Hono<AppEnvironment>();

app.use("*", requestContext);
app.use(
  "/api/public/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);
app.on(["GET", "POST"], "/api/auth/*", (context) => {
  const requestOrigin = new URL(context.req.url).origin;
  return createAuth(context.env, requestOrigin).handler(context.req.raw);
});

app.get("/api/health", async (context) => {
  try {
    const result = await context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM d1_migrations",
    ).first<{ count: number }>();
    return context.json({
      data: {
        status: "ok",
        service: context.env.APP_NAME,
        environment: context.env.ENVIRONMENT,
        migrations: result?.count ?? 0,
      },
    });
  } catch (error) {
    return apiError(
      context,
      503,
      "database_unavailable",
      "D1へ接続できません",
      error instanceof Error ? error.message : String(error),
    );
  }
});

app.get("/api/openapi.json", (context) =>
  context.json(createOpenApiDocument(context.env.APP_URL)),
);

app.post("/api/webhooks/resend/:workspaceId", async (context) => {
  const workspaceId = context.req.param("workspaceId");
  const config = await context.env.DB.prepare(
    `SELECT encrypted_credentials FROM provider_configs
     WHERE workspace_id = ? AND provider = 'resend' AND enabled = 1
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(workspaceId)
    .first<{ encrypted_credentials: string }>();
  const credentials = config
    ? await decryptCredentials<{ apiKey: string; webhookSecret: string }>(
        context.env.CREDENTIAL_ENCRYPTION_KEY,
        config.encrypted_credentials,
      )
    : null;
  const webhookSecret = credentials?.webhookSecret ?? context.env.RESEND_WEBHOOK_SECRET;
  const apiKey = credentials?.apiKey ?? context.env.RESEND_API_KEY;
  if (!webhookSecret) {
    return apiError(
      context,
      404,
      "resend_webhook_not_configured",
      "Resend Webhook設定がありません",
    );
  }
  const rawBody = await context.req.text();
  const adapter = new ResendEmailAdapter({ apiKey: apiKey ?? "", webhookSecret });
  const verification = await adapter.verifyWebhook(context.req.raw, rawBody);
  if (!verification.valid) {
    return apiError(context, 401, "invalid_webhook_signature", "Webhook署名が無効です");
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError(context, 400, "invalid_json", "JSONが不正です");
  }
  const events = adapter.normalizeEvents(body, workspaceId, verification.eventId);
  for (const event of events) {
    const status =
      event.type === "delivered"
        ? "delivered"
        : event.type === "failed" || event.type === "bounced"
          ? "failed"
          : null;
    const statements: D1PreparedStatement[] = [
      context.env.DB.prepare(
        `INSERT OR IGNORE INTO delivery_events
         (id, workspace_id, delivery_id, provider, provider_event_id,
          provider_message_id, type, occurred_at, metadata, created_at)
         SELECT ?, ?, d.id, 'resend', ?, ?, ?, ?, ?, ?
         FROM deliveries d WHERE d.workspace_id = ? AND d.id = ?`,
      ).bind(
        uuidv7(),
        workspaceId,
        event.id,
        event.providerMessageId ?? null,
        event.type,
        event.occurredAt,
        JSON.stringify(event.metadata),
        new Date().toISOString(),
        workspaceId,
        event.deliveryId,
      ),
    ];
    if (status) {
      statements.push(
        context.env.DB.prepare(
          `UPDATE deliveries SET status = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        ).bind(status, new Date().toISOString(), workspaceId, event.deliveryId),
      );
    }
    if (["bounced", "complained", "unsubscribed"].includes(event.type)) {
      statements.push(
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO suppressions
           (id, workspace_id, contact_id, email, reason, provider, created_at)
           SELECT ?, d.workspace_id, d.contact_id, d.recipient, ?, 'resend', ?
           FROM deliveries d WHERE d.workspace_id = ? AND d.id = ?`,
        ).bind(
          uuidv7(),
          event.type === "bounced"
            ? "bounce"
            : event.type === "complained"
              ? "complaint"
              : "global_unsubscribe",
          event.occurredAt,
          workspaceId,
          event.deliveryId,
        ),
      );
    }
    await context.env.DB.batch(statements);
  }
  return context.json({ data: { accepted: events.length } }, 202);
});

app.route("/api/v1", createApi());
registerPublicRoutes(app);

app.notFound((context) => apiError(context, 404, "not_found", "リソースが見つかりません"));
app.onError((error, context) => {
  console.error("Unhandled request error", {
    requestId: context.get("requestId"),
    error: error.message,
    stack: error.stack,
  });
  return apiError(context, 500, "internal_error", "処理中にエラーが発生しました");
});

export { app };

function createApi(): Hono<AppEnvironment> {
  const api = new Hono<AppEnvironment>();
  api.use("*", requireWorkspace);

  api.get("/workspace", async (context) => {
    const workspace = context.get("workspace");
    const organization = await context.env.DB.prepare(
      "SELECT id, name, slug, logo, timezone, created_at FROM organization WHERE id = ?",
    )
      .bind(workspace.workspaceId)
      .first();
    return context.json({ data: { ...organization, role: workspace.role } });
  });

  api.get("/contacts", async (context) => {
    const repository = new WorkspaceRepository(context.env.DB, context.get("workspace"));
    const cursor = context.req.query("cursor");
    const query = context.req.query("q");
    const limit = numberQuery(context.req.query("limit"));
    const scoreMin = numberQuery(context.req.query("scoreMin"));
    const scoreMax = numberQuery(context.req.query("scoreMax"));
    const status = context.req.query("status");
    const sort = context.req.query("sort");
    const direction = context.req.query("direction");
    const stage = context.req.query("stage");
    const tagId = context.req.query("tagId");
    const listId = context.req.query("listId");
    const accountId = context.req.query("accountId");
    const segmentId = context.req.query("segmentId");
    const page = await repository.listContacts({
      ...(cursor ? { cursor } : {}),
      ...(query ? { query } : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(status && ["active", "archived", "anonymous", "all"].includes(status)
        ? { status: status as "active" | "archived" | "anonymous" | "all" }
        : {}),
      ...(stage ? { stage } : {}),
      ...(tagId ? { tagId } : {}),
      ...(listId ? { listId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(segmentId ? { segmentId } : {}),
      ...(scoreMin === undefined ? {} : { scoreMin }),
      ...(scoreMax === undefined ? {} : { scoreMax }),
      ...(sort && ["createdAt", "updatedAt", "score", "name", "email"].includes(sort)
        ? { sort: sort as "createdAt" | "updatedAt" | "score" | "name" | "email" }
        : {}),
      ...(direction === "asc" || direction === "desc" ? { direction } : {}),
    });
    const data = await attachContactRelations(
      context.env.DB,
      context.get("workspace").workspaceId,
      page.items,
    );
    return context.json({
      data,
      meta: {
        total: page.total,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        requestId: context.get("requestId"),
      },
    });
  });

  api.get("/contacts/:id", async (context) => {
    const repository = new WorkspaceRepository(context.env.DB, context.get("workspace"));
    const contact = await repository.getContact(context.req.param("id"));
    return contact
      ? context.json({ data: contact })
      : apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
  });

  api.get("/contacts/:id/timeline", async (context) => {
    const workspace = context.get("workspace");
    const exists = await context.env.DB.prepare(
      "SELECT id FROM contacts WHERE workspace_id = ? AND id = ?",
    )
      .bind(workspace.workspaceId, context.req.param("id"))
      .first();
    if (!exists) return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    const result = await context.env.DB.prepare(
      `SELECT id, type, resource_type, resource_id, properties, occurred_at
       FROM contact_events WHERE workspace_id = ? AND contact_id = ?
       ORDER BY occurred_at DESC, id DESC LIMIT 200`,
    )
      .bind(workspace.workspaceId, context.req.param("id"))
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["properties"])),
    });
  });

  api.post("/contacts", requireRole("marketer"), async (context) => {
    const parsed = contactCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const repository = new WorkspaceRepository(context.env.DB, context.get("workspace"));
    try {
      const contact = await repository.createContact(parsed.data);
      context.executionCtx.waitUntil(
        writeAuditLog(context.env.DB, context.get("workspace"), {
          action: "contact.create",
          resourceType: "contact",
          resourceId: contact.id,
        }),
      );
      return context.json({ data: contact }, 201);
    } catch (error) {
      return apiError(
        context,
        409,
        "contact_conflict",
        "同じメールアドレスまたは外部IDの連絡先が既に存在します",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  api.patch("/contacts/:id", requireRole("marketer"), async (context) => {
    const parsed = contactUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const repository = new WorkspaceRepository(context.env.DB, context.get("workspace"));
    const existing = await repository.getContact(context.req.param("id"));
    if (!existing) {
      return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    }
    if (existing.status === "archived") {
      return apiError(
        context,
        409,
        "contact_archived",
        "アーカイブ済みの連絡先は編集できません",
      );
    }
    const contact = await repository.updateContact(context.req.param("id"), parsed.data);
    if (!contact) return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    return context.json({ data: contact });
  });

  api.delete("/contacts/:id", requireRole("admin"), async (context) => {
    const repository = new WorkspaceRepository(context.env.DB, context.get("workspace"));
    const archived = await repository.archiveContact(context.req.param("id"));
    return archived
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
  });

  registerAccountRoutes(api);
  registerContactManagementRoutes(api);
  registerSegmentRoutes(api);
  registerTemplateRoutes(api);
  registerMessageVariableRoutes(api);
  registerCampaignRoutes(api);
  registerBroadcastRoutes(api);
  registerFormRoutes(api);
  registerAssetRoutes(api);
  registerContentAndIntegrationRoutes(api);
  registerOperationsRoutes(api);
  return api;
}

function registerAccountRoutes(api: Hono<AppEnvironment>): void {
  api.get("/accounts", async (context) => {
    const repository = new WorkspaceRepository(
      context.env.DB,
      context.get("workspace"),
    );
    const query = context.req.query("q")?.trim();
    const limit = numberQuery(context.req.query("limit"));
    const accounts = await repository.listAccounts({
      ...(query ? { query } : {}),
      ...(limit === undefined ? {} : { limit }),
    });
    return context.json({ data: accounts });
  });

  api.get("/accounts/:id", async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const repository = new WorkspaceRepository(
      context.env.DB,
      context.get("workspace"),
    );
    const account = await repository.getAccount(context.req.param("id"));
    if (!account) {
      return apiError(
        context,
        404,
        "account_not_found",
        "アカウントが見つかりません",
      );
    }
    const contacts = await context.env.DB.prepare(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.stage, c.score,
              c.status, cc.title, cc.is_primary
       FROM company_contacts cc
       JOIN contacts c
         ON c.workspace_id = cc.workspace_id AND c.id = cc.contact_id
       WHERE cc.workspace_id = ? AND cc.company_id = ?
       ORDER BY cc.is_primary DESC,
                COALESCE(c.last_name, c.first_name, c.email, c.id) ASC`,
    )
      .bind(workspaceId, account.id)
      .all();
    return context.json({
      data: {
        ...account,
        contacts: contacts.results.map((contact) => ({
          ...contact,
          is_primary: Boolean(contact["is_primary"]),
        })),
      },
    });
  });

  api.post("/accounts", requireRole("marketer"), async (context) => {
    const parsed = accountCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const repository = new WorkspaceRepository(
      context.env.DB,
      context.get("workspace"),
    );
    try {
      const account = await repository.createAccount(parsed.data);
      context.executionCtx.waitUntil(
        writeAuditLog(context.env.DB, context.get("workspace"), {
          action: "account.create",
          resourceType: "account",
          resourceId: account.id,
        }),
      );
      return context.json({ data: account }, 201);
    } catch (error) {
      return apiError(
        context,
        409,
        "account_conflict",
        "同じドメインのアカウントが既に存在します",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  api.patch("/accounts/:id", requireRole("marketer"), async (context) => {
    const parsed = accountUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const repository = new WorkspaceRepository(
      context.env.DB,
      context.get("workspace"),
    );
    try {
      const account = await repository.updateAccount(
        context.req.param("id"),
        parsed.data,
      );
      return account
        ? context.json({ data: account })
        : apiError(
            context,
            404,
            "account_not_found",
            "アカウントが見つかりません",
          );
    } catch (error) {
      return apiError(
        context,
        409,
        "account_conflict",
        "同じドメインのアカウントが既に存在します",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  api.post(
    "/accounts/:id/contacts",
    requireRole("marketer"),
    async (context) => {
      const parsed = z
        .object({
          contactId: z.string().min(1),
          title: z.string().trim().max(191).optional(),
          isPrimary: z.boolean().default(false),
        })
        .safeParse(await safeJson(context));
      if (!parsed.success) return validationError(context, parsed.error);
      const workspaceId = context.get("workspace").workspaceId;
      const accountId = context.req.param("id");
      const relationExists = await context.env.DB.prepare(
        `SELECT co.id
         FROM companies co
         JOIN contacts c ON c.workspace_id = co.workspace_id
         WHERE co.workspace_id = ? AND co.id = ? AND c.id = ?
           AND c.status != 'archived'`,
      )
        .bind(workspaceId, accountId, parsed.data.contactId)
        .first();
      if (!relationExists) {
        return apiError(
          context,
          404,
          "account_contact_not_found",
          "アカウントまたは連絡先が見つかりません",
        );
      }
      const now = new Date().toISOString();
      const assign = context.env.DB.prepare(
        `INSERT INTO company_contacts
         (workspace_id, company_id, contact_id, title, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, company_id, contact_id)
         DO UPDATE SET title = excluded.title, is_primary = excluded.is_primary`,
      ).bind(
        workspaceId,
        accountId,
        parsed.data.contactId,
        parsed.data.title ?? null,
        parsed.data.isPrimary ? 1 : 0,
        now,
      );
      if (parsed.data.isPrimary) {
        await context.env.DB.batch([
          context.env.DB.prepare(
            `UPDATE company_contacts SET is_primary = 0
             WHERE workspace_id = ? AND contact_id = ?`,
          ).bind(workspaceId, parsed.data.contactId),
          assign,
        ]);
      } else {
        await assign.run();
      }
      return context.json({ data: { assigned: true } }, 201);
    },
  );

  api.delete(
    "/accounts/:id/contacts/:contactId",
    requireRole("marketer"),
    async (context) => {
      const result = await context.env.DB.prepare(
        `DELETE FROM company_contacts
         WHERE workspace_id = ? AND company_id = ? AND contact_id = ?`,
      )
        .bind(
          context.get("workspace").workspaceId,
          context.req.param("id"),
          context.req.param("contactId"),
        )
        .run();
      return result.meta.changes > 0
        ? context.json({ data: { removed: true } })
        : apiError(
            context,
            404,
            "account_contact_not_found",
            "アカウントとの関連が見つかりません",
          );
    },
  );
}

function registerContactManagementRoutes(api: Hono<AppEnvironment>): void {
  api.get("/contact-options", async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const optionResults = await context.env.DB.batch([
      context.env.DB.prepare(
        `SELECT t.id, t.name, t.slug, t.color, COUNT(ct.contact_id) AS contact_count
         FROM tags t
         LEFT JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         WHERE t.workspace_id = ?
         GROUP BY t.id ORDER BY t.name`,
      ).bind(workspaceId),
      context.env.DB.prepare(
        `SELECT cl.id, cl.name, cl.slug, cl.description, cl.color,
                COUNT(CASE WHEN clm.status = 'active' THEN 1 END) AS contact_count
         FROM contact_lists cl
         LEFT JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         WHERE cl.workspace_id = ?
         GROUP BY cl.id ORDER BY cl.name`,
      ).bind(workspaceId),
      context.env.DB.prepare(
        `SELECT id, name, slug, kind, filter_ast, member_count, evaluated_at
         FROM segments WHERE workspace_id = ? ORDER BY name`,
      ).bind(workspaceId),
      context.env.DB.prepare(
        `SELECT stage, COUNT(*) AS contact_count
         FROM contacts
         WHERE workspace_id = ? AND status != 'archived'
         GROUP BY stage ORDER BY stage`,
      ).bind(workspaceId),
      context.env.DB.prepare(
        `SELECT co.id, co.name, co.domain,
                COUNT(CASE WHEN c.status != 'archived' THEN 1 END) AS contact_count
         FROM companies co
         LEFT JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         LEFT JOIN contacts c
           ON c.workspace_id = cc.workspace_id AND c.id = cc.contact_id
         WHERE co.workspace_id = ?
         GROUP BY co.id ORDER BY co.name`,
      ).bind(workspaceId),
    ]);
    const tags = optionResults[0]!;
    const lists = optionResults[1]!;
    const segments = optionResults[2]!;
    const stages = optionResults[3]!;
    const accounts = optionResults[4]!;
    return context.json({
      data: {
        tags: tags.results,
        lists: lists.results,
        segments: segments.results.map(parseJsonColumns(["filter_ast"])),
        stages: stages.results,
        accounts: accounts.results,
      },
    });
  });

  api.post("/tags", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const id = uuidv7();
    const slug = resourceSlug(parsed.data.name, id);
    try {
      await context.env.DB.prepare(
        `INSERT INTO tags (id, workspace_id, name, slug, color, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, workspaceId, parsed.data.name, slug, parsed.data.color, new Date().toISOString())
        .run();
      return context.json({ data: { id, slug, ...parsed.data } }, 201);
    } catch {
      return apiError(context, 409, "tag_conflict", "同名のタグが既に存在します");
    }
  });

  api.post("/contact-lists", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        description: z.string().trim().max(2_000).default(""),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const id = uuidv7();
    const slug = resourceSlug(parsed.data.name, id);
    const now = new Date().toISOString();
    try {
      await context.env.DB.prepare(
        `INSERT INTO contact_lists
         (id, workspace_id, name, slug, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          workspaceId,
          parsed.data.name,
          slug,
          parsed.data.description,
          parsed.data.color,
          now,
          now,
        )
        .run();
      return context.json({ data: { id, slug, ...parsed.data } }, 201);
    } catch {
      return apiError(context, 409, "list_conflict", "同名のリストが既に存在します");
    }
  });

  api.get("/contacts/:id/profile", async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const contactId = context.req.param("id");
    const repository = new WorkspaceRepository(context.env.DB, context.get("workspace"));
    const contact = await repository.getContact(contactId);
    if (!contact) return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    const profileResults = await context.env.DB.batch([
      context.env.DB.prepare(
        `SELECT t.id, t.name, t.slug, t.color
         FROM tags t JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         WHERE ct.workspace_id = ? AND ct.contact_id = ?
         ORDER BY t.name`,
      ).bind(workspaceId, contactId),
      context.env.DB.prepare(
        `SELECT cl.id, cl.name, cl.slug, cl.color, clm.status, clm.updated_at
         FROM contact_lists cl JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         WHERE clm.workspace_id = ? AND clm.contact_id = ?
         ORDER BY cl.name`,
      ).bind(workspaceId, contactId),
      context.env.DB.prepare(
        `SELECT s.id, s.name, s.kind, sm.source, sm.joined_at
         FROM segments s JOIN segment_memberships sm
           ON sm.workspace_id = s.workspace_id AND sm.segment_id = s.id
         WHERE sm.workspace_id = ? AND sm.contact_id = ?
         ORDER BY s.name`,
      ).bind(workspaceId, contactId),
      context.env.DB.prepare(
        `SELECT co.id, co.name, co.domain, cc.title, cc.is_primary
         FROM companies co JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         WHERE cc.workspace_id = ? AND cc.contact_id = ?
         ORDER BY cc.is_primary DESC, co.name`,
      ).bind(workspaceId, contactId),
      context.env.DB.prepare(
        `SELECT id, delta, total, reason, created_at
         FROM score_events
         WHERE workspace_id = ? AND contact_id = ?
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(workspaceId, contactId),
      context.env.DB.prepare(
        `SELECT id, type, resource_type, resource_id, properties, occurred_at
         FROM contact_events
         WHERE workspace_id = ? AND contact_id = ?
         ORDER BY occurred_at DESC, id DESC LIMIT 100`,
      ).bind(workspaceId, contactId),
    ]);
    const tags = profileResults[0]!;
    const lists = profileResults[1]!;
    const segments = profileResults[2]!;
    const accounts = profileResults[3]!;
    const scoreEvents = profileResults[4]!;
    const timeline = profileResults[5]!;
    return context.json({
      data: {
        contact,
        tags: tags.results,
        lists: lists.results,
        segments: segments.results,
        accounts: (
          accounts.results as Array<{
            id: string;
            name: string;
            domain: string | null;
            title: string | null;
            is_primary: number;
          }>
        ).map((account) => ({
          ...account,
          is_primary: Boolean(account.is_primary),
        })),
        scoreEvents: scoreEvents.results,
        timeline: timeline.results.map(parseJsonColumns(["properties"])),
      },
    });
  });

  api.post("/contacts/:id/tags", requireRole("marketer"), async (context) => {
    const parsed = z.object({ tagId: z.string().min(1) }).safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const result = await context.env.DB.prepare(
      `INSERT OR IGNORE INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
       SELECT c.workspace_id, c.id, t.id, ?
       FROM contacts c JOIN tags t ON t.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived' AND t.id = ?`,
    )
      .bind(new Date().toISOString(), workspaceId, context.req.param("id"), parsed.data.tagId)
      .run();
    return result.meta.changes > 0
      ? context.json({ data: { assigned: true } }, 201)
      : apiError(context, 409, "tag_not_assignable", "タグを追加できませんでした");
  });

  api.delete("/contacts/:id/tags/:tagId", requireRole("marketer"), async (context) => {
    const result = await context.env.DB.prepare(
      `DELETE FROM contact_tags
       WHERE workspace_id = ? AND contact_id = ? AND tag_id = ?
         AND EXISTS (
           SELECT 1 FROM contacts c
           WHERE c.workspace_id = contact_tags.workspace_id
             AND c.id = contact_tags.contact_id AND c.status != 'archived'
         )`,
    )
      .bind(
        context.get("workspace").workspaceId,
        context.req.param("id"),
        context.req.param("tagId"),
      )
      .run();
    return result.meta.changes > 0
      ? context.json({ data: { removed: true } })
      : apiError(context, 409, "tag_not_removable", "タグを削除できませんでした");
  });

  api.post("/contacts/:id/lists", requireRole("marketer"), async (context) => {
    const parsed = z.object({ listId: z.string().min(1) }).safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `INSERT INTO contact_list_memberships
       (workspace_id, list_id, contact_id, status, source, created_at, updated_at)
       SELECT c.workspace_id, cl.id, c.id, 'active', 'manual', ?, ?
       FROM contacts c JOIN contact_lists cl ON cl.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived' AND cl.id = ?
       ON CONFLICT(workspace_id, list_id, contact_id)
       DO UPDATE SET status = 'active', source = 'manual', updated_at = excluded.updated_at`,
    )
      .bind(now, now, workspaceId, context.req.param("id"), parsed.data.listId)
      .run();
    return result.meta.changes > 0
      ? context.json({ data: { assigned: true } }, 201)
      : apiError(context, 409, "list_not_assignable", "リストへ追加できませんでした");
  });

  api.delete("/contacts/:id/lists/:listId", requireRole("marketer"), async (context) => {
    const result = await context.env.DB.prepare(
      `DELETE FROM contact_list_memberships
       WHERE workspace_id = ? AND contact_id = ? AND list_id = ?
         AND EXISTS (
           SELECT 1 FROM contacts c
           WHERE c.workspace_id = contact_list_memberships.workspace_id
             AND c.id = contact_list_memberships.contact_id AND c.status != 'archived'
         )`,
    )
      .bind(
        context.get("workspace").workspaceId,
        context.req.param("id"),
        context.req.param("listId"),
      )
      .run();
    return result.meta.changes > 0
      ? context.json({ data: { removed: true } })
      : apiError(context, 409, "list_not_removable", "リストから削除できませんでした");
  });

  api.post("/contacts/:id/segments", requireRole("marketer"), async (context) => {
    const parsed = z.object({ segmentId: z.string().min(1) }).safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const result = await context.env.DB.prepare(
      `INSERT OR IGNORE INTO segment_memberships
       (workspace_id, segment_id, contact_id, source, joined_at)
       SELECT c.workspace_id, s.id, c.id, 'static', ?
       FROM contacts c JOIN segments s ON s.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status != 'archived'
         AND s.id = ? AND s.kind = 'static'`,
    )
      .bind(new Date().toISOString(), workspaceId, context.req.param("id"), parsed.data.segmentId)
      .run();
    if (result.meta.changes === 0) {
      return apiError(
        context,
        409,
        "segment_not_assignable",
        "静的セグメントへ追加できませんでした",
      );
    }
    await updateSegmentMemberCount(context.env.DB, workspaceId, parsed.data.segmentId);
    return context.json({ data: { assigned: true } }, 201);
  });

  api.delete(
    "/contacts/:id/segments/:segmentId",
    requireRole("marketer"),
    async (context) => {
      const workspaceId = context.get("workspace").workspaceId;
      const result = await context.env.DB.prepare(
        `DELETE FROM segment_memberships
         WHERE workspace_id = ? AND contact_id = ? AND segment_id = ? AND source = 'static'
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = segment_memberships.workspace_id
               AND c.id = segment_memberships.contact_id AND c.status != 'archived'
           )`,
      )
        .bind(workspaceId, context.req.param("id"), context.req.param("segmentId"))
        .run();
      if (result.meta.changes > 0) {
        await updateSegmentMemberCount(
          context.env.DB,
          workspaceId,
          context.req.param("segmentId"),
        );
      }
      return context.json({ data: { removed: true } });
    },
  );

  api.post("/contacts/:id/score", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        delta: z.number().int().min(-10_000).max(10_000).refine((value) => value !== 0),
        reason: z.string().trim().min(1).max(500),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const contactId = context.req.param("id");
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `UPDATE contacts SET score = score + ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
      .bind(parsed.data.delta, now, workspaceId, contactId)
      .run();
    if (result.meta.changes === 0) {
      return apiError(context, 409, "score_not_adjustable", "スコアを変更できませんでした");
    }
    await context.env.DB.prepare(
      `INSERT INTO score_events
       (id, workspace_id, contact_id, delta, total, reason, created_at)
       SELECT ?, workspace_id, id, ?, score, ?, ?
       FROM contacts WHERE workspace_id = ? AND id = ?`,
    )
      .bind(
        uuidv7(),
        parsed.data.delta,
        parsed.data.reason,
        now,
        workspaceId,
        contactId,
      )
      .run();
    const contact = await new WorkspaceRepository(
      context.env.DB,
      context.get("workspace"),
    ).getContact(contactId);
    return context.json({ data: contact });
  });

  api.post("/contacts/:id/restore", requireRole("admin"), async (context) => {
    const restored = await new WorkspaceRepository(
      context.env.DB,
      context.get("workspace"),
    ).restoreContact(context.req.param("id"));
    return restored
      ? context.json({ data: { restored: true } })
      : apiError(context, 404, "contact_not_archived", "復元できる連絡先が見つかりません");
  });

  api.post("/contact-actions", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        contactIds: z.array(z.string().min(1)).min(1).max(100),
        action: z.enum([
          "archive",
          "restore",
          "add_tag",
          "remove_tag",
          "add_list",
          "remove_list",
        ]),
        resourceId: z.string().min(1).optional(),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    if (
      ["archive", "restore"].includes(parsed.data.action) &&
      !["admin", "owner"].includes(context.get("workspace").role)
    ) {
      return apiError(context, 403, "forbidden", "アーカイブ操作にはAdmin権限が必要です");
    }
    if (
      ["add_tag", "remove_tag", "add_list", "remove_list"].includes(parsed.data.action) &&
      !parsed.data.resourceId
    ) {
      return apiError(context, 422, "resource_required", "対象を選択してください");
    }
    const workspaceId = context.get("workspace").workspaceId;
    const contactIds = [...new Set(parsed.data.contactIds)];
    const placeholders = contactIds.map(() => "?").join(", ");
    const now = new Date().toISOString();
    let statement: D1PreparedStatement;
    if (parsed.data.action === "archive" || parsed.data.action === "restore") {
      const archived = parsed.data.action === "archive";
      statement = context.env.DB.prepare(
        `UPDATE contacts
         SET status = ?, archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id IN (${placeholders})`,
      ).bind(
        archived ? "archived" : "active",
        archived ? now : null,
        now,
        workspaceId,
        ...contactIds,
      );
    } else if (parsed.data.action === "add_tag") {
      statement = context.env.DB.prepare(
        `INSERT OR IGNORE INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
         SELECT c.workspace_id, c.id, t.id, ?
         FROM contacts c JOIN tags t ON t.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.status != 'archived'
           AND c.id IN (${placeholders}) AND t.id = ?`,
      ).bind(now, workspaceId, ...contactIds, parsed.data.resourceId);
    } else if (parsed.data.action === "remove_tag") {
      statement = context.env.DB.prepare(
        `DELETE FROM contact_tags
         WHERE workspace_id = ? AND contact_id IN (${placeholders}) AND tag_id = ?
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = contact_tags.workspace_id
               AND c.id = contact_tags.contact_id AND c.status != 'archived'
           )`,
      ).bind(workspaceId, ...contactIds, parsed.data.resourceId);
    } else if (parsed.data.action === "add_list") {
      statement = context.env.DB.prepare(
        `INSERT INTO contact_list_memberships
         (workspace_id, list_id, contact_id, status, source, created_at, updated_at)
         SELECT c.workspace_id, cl.id, c.id, 'active', 'bulk', ?, ?
         FROM contacts c JOIN contact_lists cl ON cl.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.status != 'archived'
           AND c.id IN (${placeholders}) AND cl.id = ?
         ON CONFLICT(workspace_id, list_id, contact_id)
         DO UPDATE SET status = 'active', source = 'bulk', updated_at = excluded.updated_at`,
      ).bind(now, now, workspaceId, ...contactIds, parsed.data.resourceId);
    } else {
      statement = context.env.DB.prepare(
        `DELETE FROM contact_list_memberships
         WHERE workspace_id = ? AND contact_id IN (${placeholders}) AND list_id = ?
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = contact_list_memberships.workspace_id
               AND c.id = contact_list_memberships.contact_id AND c.status != 'archived'
           )`,
      ).bind(workspaceId, ...contactIds, parsed.data.resourceId);
    }
    const result = await statement.run();
    return context.json({ data: { updated: result.meta.changes } });
  });
}

function registerContentAndIntegrationRoutes(api: Hono<AppEnvironment>): void {
  api.get("/projects", async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT p.id, p.name, p.description, p.color, p.created_at, p.updated_at,
              COUNT(pi.resource_id) AS item_count
       FROM projects p LEFT JOIN project_items pi
         ON pi.workspace_id = p.workspace_id AND pi.project_id = p.id
       WHERE p.workspace_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/projects", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        description: z.string().max(2_000).default(""),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO projects
       (id, workspace_id, name, description, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.description,
        parsed.data.color,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.post("/projects/:id/items", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        resourceType: z.enum(["campaign", "email", "form", "page", "segment"]),
        resourceId: z.string().min(1),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context.env.DB.prepare(
      `INSERT OR IGNORE INTO project_items
       (workspace_id, project_id, resource_type, resource_id, created_at)
       SELECT ?, p.id, ?, ?, ? FROM projects p
       WHERE p.workspace_id = ? AND p.id = ?`,
    )
      .bind(
        context.get("workspace").workspaceId,
        parsed.data.resourceType,
        parsed.data.resourceId,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { added: true } }, 201)
      : apiError(context, 404, "project_not_found", "Projectが見つかりません");
  });

  api.get("/pages", async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT lp.id, lp.name, lp.slug, lp.status, lp.current_version_id,
              lp.created_at, lp.updated_at, lpv.version, lpv.content_document
       FROM landing_pages lp
       LEFT JOIN landing_page_versions lpv
         ON lpv.workspace_id = lp.workspace_id AND lpv.id = lp.current_version_id
       WHERE lp.workspace_id = ? AND lp.status != 'archived'
       ORDER BY lp.updated_at DESC`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["content_document"])),
    });
  });

  api.post("/pages", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        status: z.enum(["draft", "published"]).default("draft"),
        content: contentDocumentSchema,
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO landing_pages
         (id, workspace_id, name, slug, status, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.status,
        versionId,
        now,
        now,
      ),
      context.env.DB.prepare(
        `INSERT INTO landing_page_versions
         (id, workspace_id, page_id, version, content_document, published_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        versionId,
        workspace.workspaceId,
        id,
        JSON.stringify(parsed.data.content),
        parsed.data.status === "published" ? now : null,
        now,
      ),
    ]);
    return context.json({ data: { id, versionId } }, 201);
  });

  api.patch("/pages/:id", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        status: z.enum(["draft", "published"]),
        content: contentDocumentSchema,
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const page = await context.env.DB.prepare(
      `SELECT id, status,
              COALESCE((SELECT MAX(version) FROM landing_page_versions
                        WHERE workspace_id = ? AND page_id = landing_pages.id), 0) AS version
       FROM landing_pages WHERE workspace_id = ? AND id = ?`,
    )
      .bind(workspaceId, workspaceId, context.req.param("id"))
      .first<{ id: string; status: string; version: number }>();
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    if (page.status === "archived") {
      return apiError(context, 409, "page_archived", "アーカイブ済みページは編集できません");
    }
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO landing_page_versions
         (id, workspace_id, page_id, version, content_document, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        workspaceId,
        page.id,
        page.version + 1,
        JSON.stringify(parsed.data.content),
        parsed.data.status === "published" ? now : null,
        now,
      ),
      context.env.DB.prepare(
        `UPDATE landing_pages
         SET name = ?, slug = ?, status = ?, current_version_id = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      ).bind(
        parsed.data.name,
        parsed.data.slug,
        parsed.data.status,
        versionId,
        now,
        workspaceId,
        page.id,
      ),
    ]);
    return context.json({ data: { id: page.id, versionId } });
  });

  api.post("/pages/:id/archive", requireRole("admin"), async (context) => {
    const result = await context.env.DB.prepare(
      `UPDATE landing_pages SET status = 'archived', updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
      .bind(
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "page_not_found", "ページが見つかりません");
  });

  api.get("/subscription-topics", async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT id, name, slug, description, is_default, created_at, updated_at
       FROM subscription_topics WHERE workspace_id = ? ORDER BY name`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/subscription-topics", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().max(2_000).default(""),
        isDefault: z.boolean().default(false),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO subscription_topics
       (id, workspace_id, name, slug, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.description,
        parsed.data.isDefault ? 1 : 0,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.get("/webhook-endpoints", requireRole("admin"), async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT id, name, url, event_types, enabled, created_at, updated_at
       FROM webhook_endpoints WHERE workspace_id = ? ORDER BY updated_at DESC`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["event_types"])),
    });
  });

  api.post("/webhook-endpoints", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        url: z.url().startsWith("https://"),
        eventTypes: z.array(z.string().max(120)).max(100).default([]),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const secret = randomString(40);
    const encryptedSecret = await encryptCredentials(
      context.env.CREDENTIAL_ENCRYPTION_KEY,
      { secret },
    );
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO webhook_endpoints
       (id, workspace_id, name, url, encrypted_secret, event_types, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.url,
        encryptedSecret,
        JSON.stringify(parsed.data.eventTypes),
        now,
        now,
      )
      .run();
    return context.json({ data: { id, signingSecret: secret } }, 201);
  });

  api.get("/analytics/campaigns/:id", requireRole("analyst"), async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const [enrollments, deliveries] = await context.env.DB.batch([
      context.env.DB.prepare(
        `SELECT status, COUNT(*) AS count FROM campaign_enrollments
         WHERE workspace_id = ? AND campaign_id = ? GROUP BY status`,
      ).bind(workspaceId, context.req.param("id")),
      context.env.DB.prepare(
        `SELECT d.status, COUNT(*) AS count FROM deliveries d
         JOIN campaign_enrollments ce
           ON ce.id = d.enrollment_id AND ce.workspace_id = d.workspace_id
         WHERE d.workspace_id = ? AND ce.campaign_id = ? GROUP BY d.status`,
      ).bind(workspaceId, context.req.param("id")),
    ]);
    return context.json({
      data: {
        enrollments: enrollments?.results ?? [],
        deliveries: deliveries?.results ?? [],
      },
    });
  });
}

const broadcastInputSchema = z.object({
  name: z.string().trim().min(1).max(191),
  segmentId: z.string().min(1),
  templateVersionId: z.string().min(1),
  topicId: z.string().min(1).nullable().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
});

function registerBroadcastRoutes(api: Hono<AppEnvironment>): void {
  api.get("/broadcasts", async (context) => {
    const archived = context.req.query("archived") === "true";
    const result = await context.env.DB.prepare(
      `SELECT b.id, b.name, b.segment_id, b.template_version_id, b.topic_id,
              b.status, b.scheduled_at, b.started_at, b.completed_at,
              b.archived_at, b.created_at, b.updated_at,
              s.name AS segment_name, s.member_count,
              et.name AS template_name, ev.subject,
              (SELECT COUNT(*) FROM broadcast_recipients br
               WHERE br.workspace_id = b.workspace_id AND br.broadcast_id = b.id)
                AS recipient_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status IN ('accepted', 'delivered')) AS sent_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status = 'delivered') AS delivered_count
       FROM broadcasts b
       JOIN segments s ON s.workspace_id = b.workspace_id AND s.id = b.segment_id
       JOIN email_template_versions ev
         ON ev.workspace_id = b.workspace_id AND ev.id = b.template_version_id
       JOIN email_templates et
         ON et.workspace_id = ev.workspace_id AND et.id = ev.template_id
       WHERE b.workspace_id = ?
         AND ${archived ? "b.archived_at IS NOT NULL" : "b.archived_at IS NULL"}
       ORDER BY b.updated_at DESC LIMIT 200`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.get("/broadcasts/:id", async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT b.id, b.name, b.segment_id, b.template_version_id, b.topic_id,
              b.status, b.scheduled_at, b.started_at, b.completed_at,
              b.archived_at, b.created_at, b.updated_at,
              s.name AS segment_name, et.name AS template_name, ev.subject,
              (SELECT COUNT(*) FROM broadcast_recipients br
               WHERE br.workspace_id = b.workspace_id AND br.broadcast_id = b.id)
                AS recipient_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status IN ('accepted', 'delivered')) AS sent_count,
              (SELECT COUNT(*) FROM deliveries d
               WHERE d.workspace_id = b.workspace_id AND d.broadcast_id = b.id
                 AND d.status = 'delivered') AS delivered_count
       FROM broadcasts b
       JOIN segments s ON s.workspace_id = b.workspace_id AND s.id = b.segment_id
       JOIN email_template_versions ev
         ON ev.workspace_id = b.workspace_id AND ev.id = b.template_version_id
       JOIN email_templates et
         ON et.workspace_id = ev.workspace_id AND et.id = ev.template_id
       WHERE b.workspace_id = ? AND b.id = ?`,
    )
      .bind(
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .first();
    return row
      ? context.json({ data: row })
      : apiError(
          context,
          404,
          "broadcast_not_found",
          "メールキャンペーンが見つかりません",
        );
  });

  api.post("/broadcasts", requireRole("marketer"), async (context) => {
    const parsed = broadcastInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    if (
      !(await hasValidBroadcastResources(
        context.env.DB,
        workspace.workspaceId,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
      ))
    ) {
      return apiError(
        context,
        422,
        "invalid_broadcast_resources",
        "SegmentまたはMarketingテンプレートが見つかりません",
      );
    }
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO broadcasts
       (id, workspace_id, name, segment_id, template_version_id, topic_id,
        status, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
        parsed.data.topicId ?? null,
        parsed.data.scheduledAt ? "scheduled" : "draft",
        parsed.data.scheduledAt ?? null,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.patch("/broadcasts/:id", requireRole("marketer"), async (context) => {
    const parsed = broadcastInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    if (
      !(await hasValidBroadcastResources(
        context.env.DB,
        workspaceId,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
      ))
    ) {
      return apiError(
        context,
        422,
        "invalid_broadcast_resources",
        "SegmentまたはMarketingテンプレートが見つかりません",
      );
    }
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `UPDATE broadcasts
       SET name = ?, segment_id = ?, template_version_id = ?, topic_id = ?,
           status = ?, scheduled_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL
         AND status IN ('draft', 'scheduled')`,
    )
      .bind(
        parsed.data.name,
        parsed.data.segmentId,
        parsed.data.templateVersionId,
        parsed.data.topicId ?? null,
        parsed.data.scheduledAt ? "scheduled" : "draft",
        parsed.data.scheduledAt ?? null,
        now,
        workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { updated: true } })
      : apiError(
          context,
          409,
          "broadcast_not_editable",
          "送信済みまたはアーカイブ済みのメールキャンペーンは編集できません",
        );
  });

  api.post("/broadcasts/:id/start", requireRole("marketer"), async (context) => {
    const workspace = context.get("workspace");
    const resend = await context.env.DB.prepare(
      `SELECT id FROM provider_configs
       WHERE workspace_id = ? AND provider = 'resend' AND enabled = 1
       LIMIT 1`,
    )
      .bind(workspace.workspaceId)
      .first();
    if (!resend && !context.env.RESEND_API_KEY) {
      return apiError(
        context,
        422,
        "resend_not_configured",
        "送信前に設定画面でResend APIを設定してください",
      );
    }
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, ?),
       updated_at = ? WHERE workspace_id = ? AND id = ?
       AND archived_at IS NULL AND status IN ('draft', 'scheduled')`,
    )
      .bind(now, now, workspace.workspaceId, context.req.param("id"))
      .run();
    if (result.meta.changes !== 1) {
      return apiError(
        context,
        409,
        "broadcast_not_startable",
        "Broadcastは既に開始済みか存在しません",
      );
    }
    await context.env.CAMPAIGN_QUEUE.send({
      kind: "broadcast_batch",
      broadcastId: context.req.param("id"),
    });
    return context.json({ data: { started: true } }, 202);
  });

  api.post("/broadcasts/:id/archive", requireRole("marketer"), async (context) => {
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `UPDATE broadcasts
       SET status = CASE WHEN status IN ('draft', 'scheduled') THEN 'cancelled' ELSE status END,
           archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND archived_at IS NULL
         AND status <> 'sending'`,
    )
      .bind(
        now,
        now,
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(
          context,
          409,
          "broadcast_not_archivable",
          "送信中のメールキャンペーンはアーカイブできません",
        );
  });
}

async function hasValidBroadcastResources(
  database: D1Database,
  workspaceId: string,
  segmentId: string,
  templateVersionId: string,
): Promise<boolean> {
  const valid = await database
    .prepare(
      `SELECT s.id
       FROM segments s JOIN email_template_versions ev
         ON ev.id = ? AND ev.workspace_id = s.workspace_id
       JOIN email_templates et
         ON et.id = ev.template_id AND et.workspace_id = ev.workspace_id
       WHERE s.workspace_id = ? AND s.id = ? AND et.purpose = 'marketing'
         AND et.status <> 'archived'`,
    )
    .bind(templateVersionId, workspaceId, segmentId)
    .first();
  return Boolean(valid);
}

function registerSegmentRoutes(api: Hono<AppEnvironment>): void {
  api.get("/segments", async (context) => {
    const workspace = context.get("workspace");
    const result = await context.env.DB.prepare(
      `SELECT id, name, slug, kind, filter_ast, member_count, evaluated_at, created_at, updated_at
       FROM segments WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
    )
      .bind(workspace.workspaceId)
      .all();
    return context.json({ data: result.results.map(parseJsonColumns(["filter_ast"])) });
  });

  api.post("/segments", requireRole("marketer"), async (context) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(191),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      kind: z.enum(["static", "dynamic"]),
      filter: segmentFilterSchema.optional(),
    });
    const parsed = schema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    if (parsed.data.kind === "dynamic" && !parsed.data.filter) {
      return apiError(context, 422, "filter_required", "動的セグメントには条件が必要です");
    }
    const workspace = context.get("workspace");
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO segments
       (id, workspace_id, name, slug, kind, filter_ast, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.kind,
        parsed.data.filter ? JSON.stringify(parsed.data.filter) : null,
        now,
        now,
      )
      .run();
    if (parsed.data.kind === "dynamic") {
      await refreshSegmentMemberships(context.env.DB, workspace.workspaceId, id);
    }
    return context.json({ data: { id, ...parsed.data, createdAt: now, updatedAt: now } }, 201);
  });

  api.post("/segments/:id/refresh", requireRole("marketer"), async (context) => {
    const refreshed = await refreshSegmentMemberships(
      context.env.DB,
      context.get("workspace").workspaceId,
      context.req.param("id"),
    );
    if (!refreshed) {
      return apiError(context, 404, "segment_not_found", "セグメントが見つかりません");
    }
    return context.json({ data: { refreshed: true } });
  });

  api.post("/segments/preview", requireRole("analyst"), async (context) => {
    const parsed = segmentFilterSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const compiled = compileSegmentFilter(workspace.workspaceId, parsed.data);
    const result = await context.env.DB.prepare(`${compiled.sql} ORDER BY c.id DESC LIMIT ?`)
      .bind(...compiled.params, 100)
      .all();
    return context.json({
      data: result.results,
      meta: { capped: result.results.length === 100, requestId: context.get("requestId") },
    });
  });
}

const emailTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(191),
  purpose: messagePurposeSchema,
  subject: z.string().trim().min(1).max(998),
  previewText: z.string().max(500).default(""),
  content: contentDocumentSchema,
});

function registerTemplateRoutes(api: Hono<AppEnvironment>): void {
  api.get("/email-templates", async (context) => {
    const workspace = context.get("workspace");
    const archived = context.req.query("archived") === "true";
    const result = await context.env.DB.prepare(
      `SELECT et.id, et.name, et.purpose, et.status, et.current_version_id,
              et.created_at, et.updated_at, ev.version, ev.subject,
              ev.preview_text
       FROM email_templates et
       LEFT JOIN email_template_versions ev
         ON ev.workspace_id = et.workspace_id AND ev.id = et.current_version_id
       WHERE et.workspace_id = ?
         AND et.status ${archived ? "=" : "<>"} 'archived'
       ORDER BY et.updated_at DESC LIMIT 200`,
    )
      .bind(workspace.workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.get("/email-templates/:id", async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT et.id, et.name, et.purpose, et.status, et.current_version_id,
              et.created_at, et.updated_at, ev.version, ev.subject,
              ev.preview_text, ev.content_document
       FROM email_templates et
       JOIN email_template_versions ev
         ON ev.workspace_id = et.workspace_id AND ev.id = et.current_version_id
       WHERE et.workspace_id = ? AND et.id = ?`,
    )
      .bind(
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .first<{ content_document: string } & Record<string, unknown>>();
    return row
      ? context.json({
          data: {
            ...row,
            content_document: JSON.parse(row.content_document) as unknown,
          },
        })
      : apiError(
          context,
          404,
          "email_template_not_found",
          "メールテンプレートが見つかりません",
        );
  });

  api.post("/email-templates", requireRole("marketer"), async (context) => {
    const parsed = emailTemplateInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const rendered = renderContent(parsed.data.content, {
      contact: {},
      workspace: {},
      message: await readMessageVariableValues(
        context.env.DB,
        workspace.workspaceId,
      ),
    });
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO email_templates
         (id, workspace_id, name, purpose, status, current_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      ).bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.purpose,
        versionId,
        now,
        now,
      ),
      context.env.DB.prepare(
        `INSERT INTO email_template_versions
         (id, workspace_id, template_id, version, subject, preview_text,
          content_document, html, text, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        workspace.workspaceId,
        id,
        parsed.data.subject,
        parsed.data.previewText,
        JSON.stringify(parsed.data.content),
        rendered.html,
        rendered.text,
        now,
      ),
    ]);
    return context.json({ data: { id, versionId } }, 201);
  });

  api.put("/email-templates/:id", requireRole("marketer"), async (context) => {
    const parsed = emailTemplateInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const template = await context.env.DB.prepare(
      `SELECT id, status FROM email_templates
       WHERE workspace_id = ? AND id = ?`,
    )
      .bind(workspaceId, context.req.param("id"))
      .first<{ id: string; status: string }>();
    if (!template) {
      return apiError(
        context,
        404,
        "email_template_not_found",
        "メールテンプレートが見つかりません",
      );
    }
    if (template.status === "archived") {
      return apiError(
        context,
        409,
        "email_template_archived",
        "アーカイブ済みのテンプレートは編集できません",
      );
    }
    const latest = await context.env.DB.prepare(
      `SELECT COALESCE(MAX(version), 0) AS version
       FROM email_template_versions WHERE workspace_id = ? AND template_id = ?`,
    )
      .bind(workspaceId, template.id)
      .first<{ version: number }>();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    const rendered = renderContent(parsed.data.content, {
      contact: {},
      workspace: {},
      message: await readMessageVariableValues(context.env.DB, workspaceId),
    });
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO email_template_versions
         (id, workspace_id, template_id, version, subject, preview_text,
          content_document, html, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        workspaceId,
        template.id,
        (latest?.version ?? 0) + 1,
        parsed.data.subject,
        parsed.data.previewText,
        JSON.stringify(parsed.data.content),
        rendered.html,
        rendered.text,
        now,
      ),
      context.env.DB.prepare(
        `UPDATE email_templates
         SET name = ?, purpose = ?, status = 'draft', current_version_id = ?,
             updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
      ).bind(
        parsed.data.name,
        parsed.data.purpose,
        versionId,
        now,
        workspaceId,
        template.id,
      ),
    ]);
    return context.json({ data: { updated: true, versionId } });
  });

  api.post(
    "/email-templates/:id/archive",
    requireRole("marketer"),
    async (context) => {
      const now = new Date().toISOString();
      const result = await context.env.DB.prepare(
        `UPDATE email_templates SET status = 'archived', updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status <> 'archived'`,
      )
        .bind(
          now,
          context.get("workspace").workspaceId,
          context.req.param("id"),
        )
        .run();
      return result.meta.changes === 1
        ? context.json({ data: { archived: true } })
        : apiError(
            context,
            404,
            "email_template_not_found",
            "メールテンプレートが見つかりません",
          );
    },
  );
}

const messageVariableInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "keyは英小文字で始まり、英小文字・数字・_のみ使用できます",
    ),
  name: z.string().trim().min(1).max(191),
  value: z.string().max(20_000),
  description: z.string().max(2_000).default(""),
});

function registerMessageVariableRoutes(api: Hono<AppEnvironment>): void {
  api.get("/message-variables", async (context) => {
    const archived = context.req.query("archived") === "true";
    const result = await context.env.DB.prepare(
      `SELECT id, key, name, value, description, archived_at, created_at, updated_at
       FROM message_variables
       WHERE workspace_id = ?
         AND archived_at IS ${archived ? "NOT NULL" : "NULL"}
       ORDER BY updated_at DESC`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/message-variables", requireRole("marketer"), async (context) => {
    const parsed = messageVariableInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const now = new Date().toISOString();
    try {
      const id = uuidv7();
      await context.env.DB.prepare(
        `INSERT INTO message_variables
         (id, workspace_id, key, name, value, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          context.get("workspace").workspaceId,
          parsed.data.key,
          parsed.data.name,
          parsed.data.value,
          parsed.data.description,
          now,
          now,
        )
        .run();
      return context.json({ data: { id } }, 201);
    } catch (error) {
      return apiError(
        context,
        409,
        "message_variable_key_exists",
        "同じキーのメッセージ変数が既にあります",
        error instanceof Error ? error.message : undefined,
      );
    }
  });

  api.patch(
    "/message-variables/:id",
    requireRole("marketer"),
    async (context) => {
      const parsed = messageVariableInputSchema.safeParse(
        await safeJson(context),
      );
      if (!parsed.success) return validationError(context, parsed.error);
      try {
        const result = await context.env.DB.prepare(
          `UPDATE message_variables
           SET key = ?, name = ?, value = ?, description = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
        )
          .bind(
            parsed.data.key,
            parsed.data.name,
            parsed.data.value,
            parsed.data.description,
            new Date().toISOString(),
            context.get("workspace").workspaceId,
            context.req.param("id"),
          )
          .run();
        return result.meta.changes === 1
          ? context.json({ data: { updated: true } })
          : apiError(
              context,
              404,
              "message_variable_not_found",
              "メッセージ変数が見つかりません",
            );
      } catch (error) {
        return apiError(
          context,
          409,
          "message_variable_key_exists",
          "同じキーのメッセージ変数が既にあります",
          error instanceof Error ? error.message : undefined,
        );
      }
    },
  );

  api.post(
    "/message-variables/:id/archive",
    requireRole("marketer"),
    async (context) => {
      const now = new Date().toISOString();
      const result = await context.env.DB.prepare(
        `UPDATE message_variables SET archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
        .bind(
          now,
          now,
          context.get("workspace").workspaceId,
          context.req.param("id"),
        )
        .run();
      return result.meta.changes === 1
        ? context.json({ data: { archived: true } })
        : apiError(
            context,
            404,
            "message_variable_not_found",
            "メッセージ変数が見つかりません",
          );
    },
  );
}

async function readMessageVariableValues(
  database: D1Database,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const result = await database
    .prepare(
      `SELECT key, value FROM message_variables
       WHERE workspace_id = ? AND archived_at IS NULL`,
    )
    .bind(workspaceId)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(
    result.results.map((variable) => [variable.key, variable.value]),
  );
}

function registerCampaignRoutes(api: Hono<AppEnvironment>): void {
  api.get("/campaigns", async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT id, name, description, status, draft_version_id, published_version_id,
              created_at, updated_at
       FROM campaigns WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/campaigns", requireRole("marketer"), async (context) => {
    const parsed = campaignDefinitionSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const id = uuidv7();
    const versionId = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO campaigns
         (id, workspace_id, name, description, status, draft_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      ).bind(
        id,
        workspace.workspaceId,
        parsed.data.name,
        parsed.data.description,
        versionId,
        now,
        now,
      ),
      context.env.DB.prepare(
        `INSERT INTO campaign_versions
         (id, workspace_id, campaign_id, version, status, timezone, graph, created_at)
         VALUES (?, ?, ?, 1, 'draft', ?, ?, ?)`,
      ).bind(
        versionId,
        workspace.workspaceId,
        id,
        parsed.data.timezone,
        JSON.stringify(parsed.data),
        now,
      ),
    ]);
    return context.json({ data: { id, draftVersionId: versionId } }, 201);
  });

  api.get("/campaigns/:id/draft", async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT cv.id, cv.version, cv.graph
       FROM campaigns c
       JOIN campaign_versions cv ON cv.id = c.draft_version_id
        AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ?`,
    )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ id: string; version: number; graph: string }>();
    return row
      ? context.json({ data: { ...row, graph: JSON.parse(row.graph) as unknown } })
      : apiError(context, 404, "campaign_not_found", "キャンペーンが見つかりません");
  });

  api.put("/campaigns/:id/draft", requireRole("marketer"), async (context) => {
    const parsed = campaignDefinitionSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context.env.DB.prepare(
      `UPDATE campaign_versions SET timezone = ?, graph = ?
       WHERE workspace_id = ? AND id = (
         SELECT draft_version_id FROM campaigns WHERE workspace_id = ? AND id = ?
       ) AND status = 'draft'`,
    )
      .bind(
        parsed.data.timezone,
        JSON.stringify(parsed.data),
        context.get("workspace").workspaceId,
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    if (result.meta.changes === 0) {
      return apiError(context, 404, "campaign_not_found", "編集可能な下書きが見つかりません");
    }
    await context.env.DB.prepare(
      "UPDATE campaigns SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
    )
      .bind(
        parsed.data.name,
        parsed.data.description,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return context.json({ data: { updated: true } });
  });

  api.post("/campaigns/:id/publish", requireRole("marketer"), async (context) => {
    const workspace = context.get("workspace");
    const row = await context.env.DB.prepare(
      `SELECT c.draft_version_id, cv.version, cv.graph
       FROM campaigns c JOIN campaign_versions cv
         ON cv.id = c.draft_version_id AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND cv.status = 'draft'`,
    )
      .bind(workspace.workspaceId, context.req.param("id"))
      .first<{ draft_version_id: string; version: number; graph: string }>();
    if (!row) return apiError(context, 404, "campaign_not_found", "下書きが見つかりません");
    const parsed = campaignDefinitionSchema.safeParse(JSON.parse(row.graph));
    if (!parsed.success) return validationError(context, parsed.error);
    const validation = validateCampaign(parsed.data);
    if (validation.length > 0) {
      return apiError(context, 422, "invalid_campaign_graph", "公開できないグラフです", validation);
    }
    const nextDraftId = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE campaign_versions SET status = 'published', published_at = ?
         WHERE workspace_id = ? AND id = ? AND status = 'draft'`,
      ).bind(now, workspace.workspaceId, row.draft_version_id),
      context.env.DB.prepare(
        `INSERT INTO campaign_versions
         (id, workspace_id, campaign_id, version, status, timezone, graph, created_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      ).bind(
        nextDraftId,
        workspace.workspaceId,
        context.req.param("id"),
        row.version + 1,
        parsed.data.timezone,
        row.graph,
        now,
      ),
      context.env.DB.prepare(
        `UPDATE campaigns SET status = 'active', published_version_id = ?,
         draft_version_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`,
      ).bind(
        row.draft_version_id,
        nextDraftId,
        now,
        workspace.workspaceId,
        context.req.param("id"),
      ),
    ]);
    return context.json({
      data: { publishedVersionId: row.draft_version_id, draftVersionId: nextDraftId },
    });
  });

  api.post("/campaigns/:id/enroll", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({ contactId: z.string().min(1), sourceEventId: z.string().optional() })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const campaign = await context.env.DB.prepare(
      `SELECT c.published_version_id, cv.graph
       FROM campaigns c JOIN campaign_versions cv
         ON cv.id = c.published_version_id AND cv.workspace_id = c.workspace_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.status = 'active'`,
    )
      .bind(workspace.workspaceId, context.req.param("id"))
      .first<{ published_version_id: string; graph: string }>();
    if (!campaign) {
      return apiError(context, 404, "campaign_not_active", "公開中のキャンペーンがありません");
    }
    const graph = JSON.parse(campaign.graph) as CampaignDefinition;
    const source = graph.nodes.find((node) => node.type === "source");
    if (!source) return apiError(context, 422, "source_missing", "Sourceノードがありません");
    const enrollmentId = uuidv7();
    const jobId = uuidv7();
    const sourceEventId =
      parsed.data.sourceEventId ?? context.req.header("idempotency-key") ?? uuidv7();
    const now = new Date().toISOString();
    try {
      await context.env.DB.batch([
        context.env.DB.prepare(
          `INSERT INTO campaign_enrollments
           (id, workspace_id, campaign_id, campaign_version_id, contact_id,
            source_event_id, status, current_node_id, entered_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        ).bind(
          enrollmentId,
          workspace.workspaceId,
          context.req.param("id"),
          campaign.published_version_id,
          parsed.data.contactId,
          sourceEventId,
          source.id,
          now,
          now,
        ),
        context.env.DB.prepare(
          `INSERT INTO campaign_jobs
           (id, workspace_id, enrollment_id, campaign_version_id, node_id,
            recipient_id, idempotency_key, status, due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        ).bind(
          jobId,
          workspace.workspaceId,
          enrollmentId,
          campaign.published_version_id,
          source.id,
          parsed.data.contactId,
          `${enrollmentId}:${source.id}:${parsed.data.contactId}`,
          now,
          now,
          now,
        ),
      ]);
    } catch (error) {
      return apiError(
        context,
        409,
        "already_enrolled",
        "このイベントでは既に参加済みです",
        error instanceof Error ? error.message : undefined,
      );
    }
    return context.json({ data: { enrollmentId, jobId } }, 202);
  });
}

function registerFormRoutes(api: Hono<AppEnvironment>): void {
  const allowedDomainsSchema = z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(253)
        .transform(normalizeDomain)
        .refine(isValidDomain, "有効なドメインを入力してください"),
    )
    .max(50);

  api.get("/forms", async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT f.id, f.name, f.slug, f.status, f.version, f.definition,
              f.allowed_domains, f.turnstile_enabled, f.success_message,
              f.created_at, f.updated_at,
              (SELECT COUNT(*) FROM form_submissions fs
               WHERE fs.workspace_id = f.workspace_id AND fs.form_id = f.id)
                AS submission_count
       FROM forms f
       WHERE f.workspace_id = ? AND f.status != 'archived'
       ORDER BY f.updated_at DESC LIMIT 200`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({
      data: result.results.map(parseJsonColumns(["definition", "allowed_domains"])),
    });
  });

  api.post("/forms", requireRole("marketer"), async (context) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(191),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      status: z.enum(["draft", "published"]).default("draft"),
      definition: z.record(z.string(), z.unknown()),
      allowedDomains: allowedDomainsSchema.default([]),
      turnstileEnabled: z.boolean().default(true),
      successMessage: z.string().max(500).default("ありがとうございます。"),
    });
    const parsed = schema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO forms
       (id, workspace_id, name, slug, status, definition, allowed_domains,
        turnstile_enabled, success_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.slug,
        parsed.data.status,
        JSON.stringify(parsed.data.definition),
        JSON.stringify(parsed.data.allowedDomains),
        parsed.data.turnstileEnabled ? 1 : 0,
        parsed.data.successMessage,
        now,
        now,
    )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.patch("/forms/:id", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        status: z.enum(["draft", "published"]),
        definition: z.record(z.string(), z.unknown()),
        allowedDomains: allowedDomainsSchema.default([]),
        turnstileEnabled: z.boolean().default(true),
        successMessage: z.string().max(500).default("ありがとうございます。"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context.env.DB.prepare(
      `UPDATE forms
       SET name = ?, slug = ?, status = ?, version = version + 1,
           definition = ?, allowed_domains = ?, turnstile_enabled = ?,
           success_message = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
      .bind(
        parsed.data.name,
        parsed.data.slug,
        parsed.data.status,
        JSON.stringify(parsed.data.definition),
        JSON.stringify(parsed.data.allowedDomains),
        parsed.data.turnstileEnabled ? 1 : 0,
        parsed.data.successMessage,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { id: context.req.param("id") } })
      : apiError(context, 404, "form_not_found", "フォームが見つかりません");
  });

  api.post("/forms/:id/archive", requireRole("admin"), async (context) => {
    const result = await context.env.DB.prepare(
      `UPDATE forms SET status = 'archived', updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
      .bind(
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "form_not_found", "フォームが見つかりません");
  });

  registerWebsiteRoutes(api);
}

function registerWebsiteRoutes(api: Hono<AppEnvironment>): void {
  const messageInputSchema = z.object({
    name: z.string().trim().min(1).max(191),
    status: z.enum(["draft", "published"]).default("draft"),
    headline: z.string().trim().min(1).max(191),
    body: z.string().max(2_000).default(""),
    ctaLabel: z.string().max(100).default(""),
    ctaUrl: z.url().max(2_000).nullable().default(null),
    pagePattern: z.string().trim().min(1).max(500).default("*"),
    startsAt: z.iso.datetime().nullable().default(null),
    endsAt: z.iso.datetime().nullable().default(null),
  });

  api.get("/site-messages", async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT id, name, status, headline, body, cta_label, cta_url,
              page_pattern, starts_at, ends_at, impression_count, click_count,
              created_at, updated_at
       FROM site_messages
       WHERE workspace_id = ? AND status != 'archived'
       ORDER BY updated_at DESC`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/site-messages", requireRole("marketer"), async (context) => {
    const parsed = messageInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const id = uuidv7();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO site_messages
       (id, workspace_id, name, status, headline, body, cta_label, cta_url,
        page_pattern, starts_at, ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        context.get("workspace").workspaceId,
        parsed.data.name,
        parsed.data.status,
        parsed.data.headline,
        parsed.data.body,
        parsed.data.ctaLabel,
        parsed.data.ctaUrl,
        parsed.data.pagePattern,
        parsed.data.startsAt,
        parsed.data.endsAt,
        now,
        now,
      )
      .run();
    return context.json({ data: { id } }, 201);
  });

  api.patch("/site-messages/:id", requireRole("marketer"), async (context) => {
    const parsed = messageInputSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const result = await context.env.DB.prepare(
      `UPDATE site_messages
       SET name = ?, status = ?, headline = ?, body = ?, cta_label = ?,
           cta_url = ?, page_pattern = ?, starts_at = ?, ends_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
      .bind(
        parsed.data.name,
        parsed.data.status,
        parsed.data.headline,
        parsed.data.body,
        parsed.data.ctaLabel,
        parsed.data.ctaUrl,
        parsed.data.pagePattern,
        parsed.data.startsAt,
        parsed.data.endsAt,
        new Date().toISOString(),
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { id: context.req.param("id") } })
      : apiError(context, 404, "site_message_not_found", "サイトメッセージが見つかりません");
  });

  api.post("/site-messages/:id/archive", requireRole("admin"), async (context) => {
    const now = new Date().toISOString();
    const result = await context.env.DB.prepare(
      `UPDATE site_messages
       SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
    )
      .bind(
        now,
        now,
        context.get("workspace").workspaceId,
        context.req.param("id"),
      )
      .run();
    return result.meta.changes === 1
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "site_message_not_found", "サイトメッセージが見つかりません");
  });

  api.get("/site-tracking", async (context) => {
    const workspace = context.get("workspace");
    const [settings, summary, topPages, recentEvents, organization] = await Promise.all([
      context.env.DB.prepare(
        `SELECT enabled, allowed_domains, consent_mode, created_at, updated_at
         FROM site_tracking_settings WHERE workspace_id = ?`,
      )
        .bind(workspace.workspaceId)
        .first<{
          enabled: number;
          allowed_domains: string;
          consent_mode: string;
          created_at: string;
          updated_at: string;
        }>(),
      context.env.DB.prepare(
        `SELECT COUNT(*) AS page_views,
                COUNT(DISTINCT visitor_id) AS unique_visitors,
                COUNT(DISTINCT contact_id) AS identified_contacts
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= datetime('now', '-30 days')`,
      )
        .bind(workspace.workspaceId)
        .first<{
          page_views: number;
          unique_visitors: number;
          identified_contacts: number;
        }>(),
      context.env.DB.prepare(
        `SELECT resource_id AS url, COUNT(*) AS views
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
           AND occurred_at >= datetime('now', '-30 days')
           AND resource_id IS NOT NULL
         GROUP BY resource_id ORDER BY views DESC LIMIT 10`,
      )
        .bind(workspace.workspaceId)
        .all(),
      context.env.DB.prepare(
        `SELECT visitor_id, contact_id, resource_id, properties, occurred_at
         FROM contact_events
         WHERE workspace_id = ? AND type = 'page_viewed'
         ORDER BY occurred_at DESC LIMIT 20`,
      )
        .bind(workspace.workspaceId)
        .all(),
      context.env.DB.prepare("SELECT slug FROM organization WHERE id = ?")
        .bind(workspace.workspaceId)
        .first<{ slug: string }>(),
    ]);
    return context.json({
      data: {
        enabled: settings?.enabled === 1,
        allowedDomains: settings
          ? (JSON.parse(settings.allowed_domains) as string[])
          : [],
        consentMode: settings?.consent_mode ?? "required",
        workspaceSlug: organization?.slug ?? "",
        summary: {
          pageViews: Number(summary?.page_views ?? 0),
          uniqueVisitors: Number(summary?.unique_visitors ?? 0),
          identifiedContacts: Number(summary?.identified_contacts ?? 0),
        },
        topPages: topPages.results,
        recentEvents: recentEvents.results.map(parseJsonColumns(["properties"])),
        updatedAt: settings?.updated_at ?? null,
      },
    });
  });

  api.put("/site-tracking", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        enabled: z.boolean(),
        allowedDomains: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(253)
              .transform(normalizeDomain)
              .refine(isValidDomain, "有効なドメインを入力してください"),
          )
          .max(50),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    if (parsed.data.enabled && parsed.data.allowedDomains.length === 0) {
      return apiError(
        context,
        422,
        "tracking_domain_required",
        "トラッキングを有効にするには許可ドメインが必要です",
      );
    }
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO site_tracking_settings
       (workspace_id, enabled, allowed_domains, consent_mode, created_at, updated_at)
       VALUES (?, ?, ?, 'required', ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         enabled = excluded.enabled,
         allowed_domains = excluded.allowed_domains,
         updated_at = excluded.updated_at`,
    )
      .bind(
        context.get("workspace").workspaceId,
        parsed.data.enabled ? 1 : 0,
        JSON.stringify([...new Set(parsed.data.allowedDomains)]),
        now,
        now,
      )
      .run();
    return context.json({ data: { saved: true } });
  });
}

function registerAssetRoutes(api: Hono<AppEnvironment>): void {
  api.post("/assets", requireRole("marketer"), async (context) => {
    const contentLength = Number(context.req.header("content-length") ?? 0);
    if (contentLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "asset_too_large", "Assetは25MB以下にしてください");
    }
    const name = context.req.query("name")?.slice(0, 191);
    if (!name) return apiError(context, 422, "name_required", "nameが必要です");
    const workspace = context.get("workspace");
    const id = uuidv7();
    const key = `${workspace.workspaceId}/assets/${id}/${sanitizeFilename(name)}`;
    const body = await context.req.arrayBuffer();
    const checksum = await sha256HexFromBytes(body);
    const contentType = context.req.header("content-type") ?? "application/octet-stream";
    await context.env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { workspaceId: workspace.workspaceId, assetId: id },
      sha256: checksum,
    });
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO assets
       (id, workspace_id, name, r2_key, content_type, size, checksum, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspace.workspaceId,
        name,
        key,
        contentType,
        body.byteLength,
        checksum,
        now,
        now,
      )
      .run();
    return context.json({ data: { id, name, contentType, size: body.byteLength } }, 201);
  });

  api.get("/assets/:id", async (context) => {
    const workspace = context.get("workspace");
    const row = await context.env.DB.prepare(
      "SELECT r2_key, content_type, name FROM assets WHERE workspace_id = ? AND id = ?",
    )
      .bind(workspace.workspaceId, context.req.param("id"))
      .first<{ r2_key: string; content_type: string; name: string }>();
    if (!row) return apiError(context, 404, "asset_not_found", "Assetが見つかりません");
    const object = await context.env.ASSETS_BUCKET.get(row.r2_key);
    if (!object) return apiError(context, 404, "asset_object_missing", "R2オブジェクトがありません");
    return new Response(object.body, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Disposition": `inline; filename="${sanitizeFilename(row.name)}"`,
        ETag: object.httpEtag,
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}

function registerOperationsRoutes(api: Hono<AppEnvironment>): void {
  api.post("/contacts/import", requireRole("marketer"), async (context) => {
    const contentLength = Number(context.req.header("content-length") ?? 0);
    if (contentLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "csv_too_large", "CSVは25MB以下にしてください");
    }
    const text = await context.req.text();
    if (new TextEncoder().encode(text).byteLength > 25 * 1024 * 1024) {
      return apiError(context, 422, "csv_too_large", "CSVは25MB以下にしてください");
    }
    const rows = parseCsv(text);
    const header = rows.shift()?.map((value) => value.trim().toLowerCase());
    if (!header?.includes("email") && !header?.includes("external_id")) {
      return apiError(
        context,
        422,
        "csv_identifier_missing",
        "CSVにはemailまたはexternal_id列が必要です",
      );
    }
    const workspace = context.get("workspace");
    const jobId = uuidv7();
    const baseKey = `${workspace.workspaceId}/imports/${jobId}`;
    const partSize = 100;
    const parts: string[] = [];
    for (let offset = 0; offset < rows.length; offset += partSize) {
      const part = rows.slice(offset, offset + partSize).map((values) => {
        const record: Record<string, string> = {};
        for (const [index, name] of header.entries()) {
          if (name) record[name] = values[index] ?? "";
        }
        return JSON.stringify(record);
      });
      parts.push(part.join("\n"));
    }
    for (let offset = 0; offset < parts.length; offset += 20) {
      await Promise.all(
        parts.slice(offset, offset + 20).map((part, relativeIndex) => {
          const index = offset + relativeIndex;
          return context.env.ASSETS_BUCKET.put(`${baseKey}/part-${index}.ndjson`, part, {
            httpMetadata: { contentType: "application/x-ndjson" },
          });
        }),
      );
    }
    await context.env.ASSETS_BUCKET.put(
      `${baseKey}/manifest.json`,
      JSON.stringify({ header, parts: parts.length, rows: rows.length }),
      { httpMetadata: { contentType: "application/json" } },
    );
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO import_jobs
       (id, workspace_id, kind, r2_key, status, cursor, created_at, updated_at)
       VALUES (?, ?, 'contact_import', ?, 'pending', ?, ?, ?)`,
    )
      .bind(
        jobId,
        workspace.workspaceId,
        baseKey,
        JSON.stringify({ totalParts: parts.length }),
        now,
        now,
      )
      .run();
    if (parts.length > 0) {
      await context.env.CAMPAIGN_QUEUE.send({
        kind: "contact_import",
        importJobId: jobId,
        part: 0,
        totalParts: parts.length,
      });
    } else {
      await context.env.DB.prepare(
        "UPDATE import_jobs SET status = 'completed', updated_at = ? WHERE id = ?",
      )
        .bind(now, jobId)
        .run();
    }
    return context.json({ data: { jobId, rows: rows.length, parts: parts.length } }, 202);
  });

  api.post("/contacts/export", requireRole("analyst"), async (context) => {
    const workspace = context.get("workspace");
    const jobId = uuidv7();
    const key = `${workspace.workspaceId}/exports/contacts-${jobId}.csv`;
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO import_jobs
       (id, workspace_id, kind, r2_key, status, cursor, created_at, updated_at)
       VALUES (?, ?, 'contact_export', ?, 'pending', ?, ?, ?)`,
    )
      .bind(
        jobId,
        workspace.workspaceId,
        key,
        JSON.stringify({
          partNumber: 0,
          lastId: "",
        }),
        now,
        now,
      )
      .run();
    await context.env.CAMPAIGN_QUEUE.send({ kind: "contact_export", exportJobId: jobId });
    return context.json({ data: { jobId } }, 202);
  });

  api.get("/data-jobs/:id", requireRole("analyst"), async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT id, kind, status, processed, succeeded, failed, r2_key,
              error_manifest_key, created_at, updated_at
       FROM import_jobs WHERE workspace_id = ? AND id = ?`,
    )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first();
    return row
      ? context.json({ data: row })
      : apiError(context, 404, "data_job_not_found", "データJobが見つかりません");
  });

  api.get("/data-jobs/:id/download", requireRole("analyst"), async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT r2_key, status FROM import_jobs
       WHERE workspace_id = ? AND id = ? AND kind = 'contact_export'`,
    )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ r2_key: string; status: string }>();
    if (!row || row.status !== "completed") {
      return apiError(context, 404, "export_not_ready", "Exportはまだ完了していません");
    }
    const object = await context.env.ASSETS_BUCKET.get(row.r2_key);
    if (!object) return apiError(context, 404, "export_missing", "Exportファイルがありません");
    return new Response(object.body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kaenma-contacts-${context.req.param("id")}.csv"`,
      },
    });
  });

  api.get("/dashboard", async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const batch = await context.env.DB.batch([
      context.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM contacts WHERE workspace_id = ? AND status = 'active'",
      ).bind(workspaceId),
      context.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM campaigns WHERE workspace_id = ? AND status = 'active'",
      ).bind(workspaceId),
      context.env.DB.prepare(
        `SELECT COUNT(*) AS sent,
          SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM deliveries WHERE workspace_id = ? AND created_at >= datetime('now', '-30 day')`,
      ).bind(workspaceId),
      context.env.DB.prepare(
        `SELECT type, occurred_at, contact_id, properties FROM contact_events
         WHERE workspace_id = ? ORDER BY occurred_at DESC LIMIT 20`,
      ).bind(workspaceId),
    ]);
    const contacts = batch[0];
    const campaigns = batch[1];
    const deliveries = batch[2];
    const recent = batch[3];
    return context.json({
      data: {
        contacts: contacts?.results[0] ?? { count: 0 },
        campaigns: campaigns?.results[0] ?? { count: 0 },
        deliveries: deliveries?.results[0] ?? { sent: 0, delivered: 0, failed: 0 },
        recentEvents: (recent?.results ?? []).map(parseJsonColumns(["properties"])),
      },
    });
  });

  api.post("/api-keys", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191),
        role: workspaceRoleSchema.default("viewer"),
        expiresAt: z.iso.datetime().optional(),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const actor = context.get("workspace");
    const prefix = randomString(12);
    const secret = randomString(40);
    const token = `kaenma_${prefix}_${secret}`;
    const id = uuidv7();
    await context.env.DB.prepare(
      `INSERT INTO api_keys
       (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        actor.workspaceId,
        actor.userId,
        parsed.data.name,
        prefix,
        await sha256Hex(token),
        parsed.data.role,
        parsed.data.expiresAt ?? null,
        new Date().toISOString(),
      )
      .run();
    return context.json({ data: { id, token, prefix } }, 201);
  });

  api.post("/providers/resend", requireRole("admin"), async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(191).default("default"),
        apiKey: z.string().min(10),
        webhookSecret: z.string().min(16),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspace = context.get("workspace");
    const encrypted = await encryptCredentials(
      context.env.CREDENTIAL_ENCRYPTION_KEY,
      {
        apiKey: parsed.data.apiKey,
        webhookSecret: parsed.data.webhookSecret,
      },
    );
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO provider_configs
       (id, workspace_id, provider, name, encrypted_credentials, settings, created_at, updated_at)
       VALUES (?, ?, 'resend', ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, provider, name) DO UPDATE SET
         encrypted_credentials = excluded.encrypted_credentials,
         settings = excluded.settings,
         enabled = 1,
         updated_at = excluded.updated_at`,
    )
      .bind(
        uuidv7(),
        workspace.workspaceId,
        parsed.data.name,
        encrypted,
        JSON.stringify({}),
        now,
        now,
      )
      .run();
    return context.json({ data: { configured: true } });
  });

  api.get("/dead-letters", requireRole("admin"), async (context) => {
    const result = await context.env.DB.prepare(
      `SELECT id, source_queue, error, attempts, status, created_at, replayed_at
       FROM dead_letters WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(context.get("workspace").workspaceId)
      .all();
    return context.json({ data: result.results });
  });

  api.post("/dead-letters/:id/replay", requireRole("admin"), async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT id, source_queue, message_body FROM dead_letters
       WHERE workspace_id = ? AND id = ? AND status = 'pending'`,
    )
      .bind(context.get("workspace").workspaceId, context.req.param("id"))
      .first<{ id: string; source_queue: string; message_body: string }>();
    if (!row) return apiError(context, 404, "dead_letter_not_found", "DLQ項目が見つかりません");
    const body: unknown = JSON.parse(row.message_body);
    if (row.source_queue === "kaenma-campaign") {
      await context.env.CAMPAIGN_QUEUE.send(body);
    } else {
      await context.env.DELIVERY_QUEUE.send(body);
    }
    await context.env.DB.prepare(
      "UPDATE dead_letters SET status = 'replayed', replayed_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(new Date().toISOString(), row.id)
      .run();
    return context.json({ data: { replayed: true } });
  });
}

function registerPublicRoutes(publicApp: Hono<AppEnvironment>): void {
  publicApp.get("/p/:workspaceSlug/:pageSlug", async (context) => {
    const page = await context.env.DB.prepare(
      `SELECT lpv.content_document, o.name AS workspace_name
       FROM landing_pages lp
       JOIN organization o ON o.id = lp.workspace_id
       JOIN landing_page_versions lpv
         ON lpv.id = lp.current_version_id AND lpv.workspace_id = lp.workspace_id
       WHERE o.slug = ? AND lp.slug = ? AND lp.status = 'published'`,
    )
      .bind(context.req.param("workspaceSlug"), context.req.param("pageSlug"))
      .first<{ content_document: string; workspace_name: string }>();
    if (!page) return apiError(context, 404, "page_not_found", "ページが見つかりません");
    const document = contentDocumentSchema.safeParse(JSON.parse(page.content_document));
    if (!document.success) {
      return apiError(context, 500, "page_render_failed", "ページ定義が不正です");
    }
    const rendered = renderContent(document.data, {
      contact: {},
      workspace: { name: page.workspace_name },
    });
    return context.html(rendered.html);
  });

  publicApp.get(
    "/api/public/forms/:workspaceSlug/:formSlug/embed.js",
    async (context) => {
      const form = await context.env.DB.prepare(
        `SELECT f.name, f.definition
         FROM forms f JOIN organization o ON o.id = f.workspace_id
         WHERE o.slug = ? AND f.slug = ? AND f.status = 'published'`,
      )
        .bind(context.req.param("workspaceSlug"), context.req.param("formSlug"))
        .first<{ name: string; definition: string }>();
      if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
      let style = "inline";
      try {
        const definition = JSON.parse(form.definition) as unknown;
        if (
          isRecord(definition) &&
          ["inline", "floating-bar", "floating-box", "modal"].includes(
            String(definition["style"]),
          )
        ) {
          style = String(definition["style"]);
        }
      } catch {
        // Use the inline fallback for old definitions.
      }
      const formUrl = new URL(
        `/f/${context.req.param("workspaceSlug")}/${context.req.param("formSlug")}`,
        context.req.url,
      ).toString();
      return new Response(formEmbedScript(formUrl, form.name, style), {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
  );

  publicApp.get("/f/:workspaceSlug/:formSlug", async (context) => {
    const form = await context.env.DB.prepare(
      `SELECT f.name, f.definition, f.allowed_domains
       FROM forms f JOIN organization o ON o.id = f.workspace_id
       WHERE o.slug = ? AND f.slug = ? AND f.status = 'published'`,
    )
      .bind(context.req.param("workspaceSlug"), context.req.param("formSlug"))
      .first<{ name: string; definition: string; allowed_domains: string }>();
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    let definition: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(form.definition) as unknown;
      if (isRecord(parsed)) definition = parsed;
    } catch {
      // Render the required email field when an old definition cannot be parsed.
    }
    const domains = JSON.parse(form.allowed_domains) as string[];
    const frameAncestors =
      domains.length > 0
        ? domains.flatMap((domain) => [
            `https://${domain}`,
            `https://*.${domain}`,
            `http://${domain}`,
            `http://*.${domain}`,
          ])
        : ["https:", "http:"];
    context.header(
      "Content-Security-Policy",
      `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' ${frameAncestors.join(" ")}`,
    );
    return context.html(renderPublicForm(form.name, definition, context.req.url));
  });

  publicApp.post("/f/:workspaceSlug/:formSlug", async (context) => {
    const form = await context.env.DB.prepare(
      `SELECT f.id, f.workspace_id, f.allowed_domains, f.turnstile_enabled, f.success_message
       FROM forms f JOIN organization o ON o.id = f.workspace_id
       WHERE o.slug = ? AND f.slug = ? AND f.status = 'published'`,
    )
      .bind(context.req.param("workspaceSlug"), context.req.param("formSlug"))
      .first<{
        id: string;
        workspace_id: string;
        allowed_domains: string;
        turnstile_enabled: number;
        success_message: string;
      }>();
    if (!form) return apiError(context, 404, "form_not_found", "フォームが見つかりません");
    const allowedDomains = JSON.parse(form.allowed_domains) as string[];
    const origin = context.req.header("origin");
    const requestHostname = new URL(context.req.url).hostname;
    if (
      origin &&
      new URL(origin).hostname !== requestHostname &&
      allowedDomains.length > 0 &&
      !originAllowed(origin, allowedDomains)
    ) {
      return apiError(context, 403, "form_origin_denied", "このドメインからは送信できません");
    }
    const body = await safeJson(context);
    if (!isRecord(body)) return apiError(context, 422, "invalid_payload", "入力が不正です");
    if (body["_website"]) return context.json({ data: { accepted: true } }, 202);
    if (
      form.turnstile_enabled === 1 &&
      context.env.TURNSTILE_SECRET &&
      !(await verifyTurnstile(
        context.env.TURNSTILE_SECRET,
        String(body["turnstileToken"] ?? ""),
        context.req.header("cf-connecting-ip"),
      ))
    ) {
      return apiError(context, 422, "turnstile_failed", "Turnstile検証に失敗しました");
    }
    const idempotencyKey =
      context.req.header("idempotency-key") ?? String(body["idempotencyKey"] ?? "");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
      return apiError(context, 422, "idempotency_key_required", "Idempotency-Keyが必要です");
    }
    const email =
      typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : null;
    const now = new Date().toISOString();
    let contactId: string | null = null;
    if (email && z.email().safeParse(email).success) {
      const existing = await context.env.DB.prepare(
        "SELECT id FROM contacts WHERE workspace_id = ? AND email = ?",
      )
        .bind(form.workspace_id, email)
        .first<{ id: string }>();
      contactId = existing?.id ?? uuidv7();
      if (existing) {
        await context.env.DB.prepare(
          `UPDATE contacts SET first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name), phone = COALESCE(?, phone),
           updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        )
          .bind(
            stringOrNull(body["firstName"]),
            stringOrNull(body["lastName"]),
            stringOrNull(body["phone"]),
            now,
            form.workspace_id,
            contactId,
          )
          .run();
      } else {
        await context.env.DB.prepare(
          `INSERT INTO contacts
           (id, workspace_id, email, first_name, last_name, phone, stage, score,
            status, custom_fields, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'lead', 0, 'active', '{}', ?, ?)`,
        )
          .bind(
            contactId,
            form.workspace_id,
            email,
            stringOrNull(body["firstName"]),
            stringOrNull(body["lastName"]),
            stringOrNull(body["phone"]),
            now,
            now,
          )
          .run();
      }
    }
    try {
      await context.env.DB.batch([
        context.env.DB.prepare(
          `INSERT INTO form_submissions
           (id, workspace_id, form_id, contact_id, idempotency_key, payload, ip_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          uuidv7(),
          form.workspace_id,
          form.id,
          contactId,
          idempotencyKey,
          JSON.stringify(redactFormPayload(body)),
          await hashIp(context.req.header("cf-connecting-ip")),
          now,
        ),
        context.env.DB.prepare(
          `INSERT INTO contact_events
           (id, workspace_id, contact_id, type, resource_type, resource_id,
            properties, occurred_at, created_at)
           VALUES (?, ?, ?, 'form_submitted', 'form', ?, ?, ?, ?)`,
        ).bind(
          uuidv7(),
          form.workspace_id,
          contactId,
          form.id,
          JSON.stringify({ formId: form.id }),
          now,
          now,
        ),
      ]);
    } catch {
      return context.json({ data: { accepted: true, duplicate: true } }, 202);
    }
    return context.json({ data: { accepted: true, message: form.success_message } }, 202);
  });

  publicApp.get(
    "/api/public/site-tracking/:workspaceSlug/script.js",
    async (context) => {
    const trackingEndpoint = new URL(
      `/api/public/track/${context.req.param("workspaceSlug")}`,
      context.req.url,
    ).toString();
    const messagesEndpoint = new URL(
      `/api/public/site-messages/${context.req.param("workspaceSlug")}`,
      context.req.url,
    ).toString();
    return new Response(siteTrackingScript(trackingEndpoint, messagesEndpoint), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
    },
  );

  publicApp.post("/api/public/track/:workspaceSlug", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.env.DB,
      context.req.param("workspaceSlug"),
    );
    if (!workspace) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return apiError(context, 403, "tracking_origin_denied", "このドメインは許可されていません");
    }
    const parsed = z
      .object({
        consent: z.literal(true),
        visitorId: z.string().uuid().optional(),
        email: z.email().optional(),
        type: z.enum(["page_viewed", "custom_event"]),
        resourceId: z.string().max(2_000).optional(),
        properties: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) {
      return context.json({ data: { accepted: false, identityIssued: false } }, 202);
    }
    const visitorId = parsed.data.visitorId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const contact = parsed.data.email
      ? await context.env.DB.prepare(
          `SELECT id FROM contacts
           WHERE workspace_id = ? AND email = ? AND status != 'archived'`,
        )
          .bind(workspace.id, parsed.data.email.toLowerCase())
          .first<{ id: string }>()
      : null;
    await context.env.DB.prepare(
      `INSERT INTO contact_events
       (id, workspace_id, contact_id, visitor_id, type, resource_type,
        resource_id, properties, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'page', ?, ?, ?, ?)`,
    )
      .bind(
        uuidv7(),
        workspace.id,
        contact?.id ?? null,
        visitorId,
        parsed.data.type,
        parsed.data.resourceId ?? null,
        JSON.stringify(parsed.data.properties),
        now,
        now,
      )
      .run();
    return context.json(
      {
        data: {
          accepted: true,
          visitorId,
          identified: Boolean(contact),
          identityIssued: true,
        },
      },
      202,
    );
  });

  publicApp.get("/api/public/site-messages/:workspaceSlug", async (context) => {
    const workspace = await loadPublicTrackingWorkspace(
      context.env.DB,
      context.req.param("workspaceSlug"),
    );
    const visitorId = context.req.query("visitorId");
    const pageUrl = context.req.query("url") ?? "";
    if (!workspace || !visitorId || !z.string().uuid().safeParse(visitorId).success) {
      return context.json({ data: [] });
    }
    const origin = context.req.header("origin");
    if (origin && !originAllowed(origin, workspace.allowedDomains)) {
      return context.json({ data: [] });
    }
    const identity = await context.env.DB.prepare(
      `SELECT contact_id FROM contact_events
       WHERE workspace_id = ? AND visitor_id = ? AND contact_id IS NOT NULL
       ORDER BY occurred_at DESC LIMIT 1`,
    )
      .bind(workspace.id, visitorId)
      .first<{ contact_id: string }>();
    if (!identity) return context.json({ data: [] });
    const result = await context.env.DB.prepare(
      `SELECT id, headline, body, cta_label, cta_url, page_pattern
       FROM site_messages
       WHERE workspace_id = ? AND status = 'published'
         AND (starts_at IS NULL OR starts_at <= ?)
         AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY updated_at DESC LIMIT 20`,
    )
      .bind(workspace.id, new Date().toISOString(), new Date().toISOString())
      .all<{
        id: string;
        headline: string;
        body: string;
        cta_label: string;
        cta_url: string | null;
        page_pattern: string;
      }>();
    return context.json({
      data: result.results
        .filter((message) => pagePatternMatches(pageUrl, message.page_pattern))
        .slice(0, 1),
    });
  });

  publicApp.post(
    "/api/public/site-messages/:workspaceSlug/:messageId/events",
    async (context) => {
      const workspace = await loadPublicTrackingWorkspace(
        context.env.DB,
        context.req.param("workspaceSlug"),
      );
      if (!workspace) return context.json({ data: { accepted: false } }, 202);
      const origin = context.req.header("origin");
      if (origin && !originAllowed(origin, workspace.allowedDomains)) {
        return apiError(context, 403, "tracking_origin_denied", "このドメインは許可されていません");
      }
      const parsed = z
        .object({
          visitorId: z.string().uuid(),
          type: z.enum(["impression", "click"]),
        })
        .safeParse(await safeJson(context));
      if (!parsed.success) return context.json({ data: { accepted: false } }, 202);
      const identity = await context.env.DB.prepare(
        `SELECT contact_id FROM contact_events
         WHERE workspace_id = ? AND visitor_id = ? AND contact_id IS NOT NULL
         ORDER BY occurred_at DESC LIMIT 1`,
      )
        .bind(workspace.id, parsed.data.visitorId)
        .first<{ contact_id: string }>();
      if (!identity) return context.json({ data: { accepted: false } }, 202);
      const now = new Date().toISOString();
      const messageId = context.req.param("messageId");
      const counter =
        parsed.data.type === "impression" ? "impression_count" : "click_count";
      const result = await context.env.DB.prepare(
        `UPDATE site_messages SET ${counter} = ${counter} + 1, updated_at = updated_at
         WHERE workspace_id = ? AND id = ? AND status = 'published'`,
      )
        .bind(workspace.id, messageId)
        .run();
      if (result.meta.changes !== 1) {
        return context.json({ data: { accepted: false } }, 202);
      }
      await context.env.DB.prepare(
        `INSERT INTO contact_events
         (id, workspace_id, contact_id, visitor_id, type, resource_type,
          resource_id, properties, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'site_message', ?, '{}', ?, ?)`,
      )
        .bind(
          uuidv7(),
          workspace.id,
          identity.contact_id,
          parsed.data.visitorId,
          parsed.data.type === "impression"
            ? "site_message_viewed"
            : "site_message_clicked",
          messageId,
          now,
          now,
        )
        .run();
      return context.json({ data: { accepted: true } }, 202);
    },
  );

  publicApp.get("/t/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "tracking",
    );
    if (payload) {
      context.executionCtx.waitUntil(
        context.env.DB.prepare(
          `INSERT INTO contact_events
           (id, workspace_id, contact_id, type, resource_type, resource_id,
            properties, occurred_at, created_at)
           VALUES (?, ?, ?, 'email_opened', 'delivery', ?, '{}', ?, ?)`,
        )
          .bind(
            uuidv7(),
            payload.workspaceId,
            payload.contactId ?? null,
            payload.resourceId,
            new Date().toISOString(),
            new Date().toISOString(),
          )
          .run()
          .then(() => undefined),
      );
    }
    return new Response(transparentGif, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, private",
      },
    });
  });

  publicApp.get("/u/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_unsubscribe_token", "解除リンクが無効です");
    }
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT OR IGNORE INTO suppressions
         (id, workspace_id, contact_id, reason, created_at)
         VALUES (?, ?, ?, 'global_unsubscribe', ?)`,
      ).bind(uuidv7(), payload.workspaceId, payload.contactId, now),
      context.env.DB.prepare(
        `INSERT INTO consent_events
         (id, workspace_id, contact_id, action, source, created_at)
         VALUES (?, ?, ?, 'unsubscribed', 'one_click', ?)`,
      ).bind(uuidv7(), payload.workspaceId, payload.contactId, now),
    ]);
    return context.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><title>配信停止</title><body><main><h1>配信を停止しました</h1><p>設定はすぐに反映されます。</p></main></body></html>',
    );
  });

  publicApp.post("/u/:token", async (context) => {
    return context.redirect(`/u/${encodeURIComponent(context.req.param("token"))}`, 303);
  });

  publicApp.get("/preference/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_preference_token", "設定リンクが無効です");
    }
    const topics = await context.env.DB.prepare(
      `SELECT st.id, st.name, st.description,
              COALESCE(cs.status, 'unsubscribed') AS status
       FROM subscription_topics st
       LEFT JOIN contact_subscriptions cs
         ON cs.workspace_id = st.workspace_id AND cs.topic_id = st.id AND cs.contact_id = ?
       WHERE st.workspace_id = ? ORDER BY st.name`,
    )
      .bind(payload.contactId, payload.workspaceId)
      .all<{ id: string; name: string; description: string; status: string }>();
    const globalSuppression = await context.env.DB.prepare(
      `SELECT id FROM suppressions
       WHERE workspace_id = ? AND contact_id = ? AND reason = 'global_unsubscribe' LIMIT 1`,
    )
      .bind(payload.workspaceId, payload.contactId)
      .first();
    const rows = topics.results
      .map(
        (topic) => `<label style="display:block;padding:16px 0;border-bottom:1px solid #e2e8f0">
          <input type="checkbox" name="topic" value="${escapeHtml(topic.id)}" ${topic.status === "subscribed" ? "checked" : ""}>
          <strong>${escapeHtml(topic.name)}</strong>
          <span style="display:block;margin-left:24px;color:#64748b">${escapeHtml(topic.description)}</span>
        </label>`,
      )
      .join("");
    return context.html(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>配信設定</title></head>
      <body style="margin:0;background:#f5f7fb;font-family:system-ui;color:#172033"><main style="max-width:640px;margin:48px auto;background:white;padding:32px;border-radius:16px">
      <h1>配信設定</h1><p style="color:#64748b">受け取りたいトピックを選択してください。</p>
      <form method="post">${rows}
      <label style="display:block;padding:20px 0"><input type="checkbox" name="globalStop" ${globalSuppression ? "checked" : ""}> すべてのマーケティングメールを停止</label>
      <button style="border:0;border-radius:10px;background:#6d4aff;color:white;padding:12px 20px;font-weight:700">設定を保存</button>
      </form></main></body></html>`);
  });

  publicApp.post("/preference/:token", async (context) => {
    const payload = await verifySignedToken(
      context.env.TRACKING_SIGNING_SECRET,
      context.req.param("token"),
      "unsubscribe",
    );
    if (!payload?.contactId) {
      return apiError(context, 400, "invalid_preference_token", "設定リンクが無効です");
    }
    const form = await context.req.formData();
    const selected = new Set(
      form.getAll("topic").filter((value): value is string => typeof value === "string"),
    );
    const topics = await context.env.DB.prepare(
      "SELECT id FROM subscription_topics WHERE workspace_id = ?",
    )
      .bind(payload.workspaceId)
      .all<{ id: string }>();
    const now = new Date().toISOString();
    const statements = topics.results.map((topic) =>
      context.env.DB.prepare(
        `INSERT INTO contact_subscriptions
         (workspace_id, contact_id, topic_id, status, source, updated_at)
         VALUES (?, ?, ?, ?, 'preference_center', ?)
         ON CONFLICT(workspace_id, contact_id, topic_id)
         DO UPDATE SET status = excluded.status, source = excluded.source,
           updated_at = excluded.updated_at`,
      ).bind(
        payload.workspaceId,
        payload.contactId,
        topic.id,
        selected.has(topic.id) ? "subscribed" : "unsubscribed",
        now,
      ),
    );
    if (form.get("globalStop")) {
      statements.push(
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO suppressions
           (id, workspace_id, contact_id, reason, created_at)
           VALUES (?, ?, ?, 'global_unsubscribe', ?)`,
        ).bind(uuidv7(), payload.workspaceId, payload.contactId, now),
      );
    } else {
      statements.push(
        context.env.DB.prepare(
          `DELETE FROM suppressions
           WHERE workspace_id = ? AND contact_id = ? AND reason = 'global_unsubscribe'`,
        ).bind(payload.workspaceId, payload.contactId),
      );
    }
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO consent_events
         (id, workspace_id, contact_id, action, source, proof, created_at)
         VALUES (?, ?, ?, ?, 'preference_center', ?, ?)`,
      ).bind(
        uuidv7(),
        payload.workspaceId,
        payload.contactId,
        form.get("globalStop") ? "unsubscribed" : "granted",
        JSON.stringify({ topics: [...selected] }),
        now,
      ),
    );
    await context.env.DB.batch(statements);
    return context.html(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><body><main><h1>設定を保存しました</h1><p>変更は次回の送信判定から反映されます。</p></main></body></html>',
    );
  });
}

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

async function attachContactRelations(
  database: D1Database,
  workspaceId: string,
  contacts: Contact[],
): Promise<
  Array<
    Contact & {
      tags: Array<{ id: string; name: string; slug: string; color: string }>;
      lists: Array<{ id: string; name: string; slug: string; color: string }>;
      accounts: Array<{
        id: string;
        name: string;
        domain: string | null;
        title: string | null;
        is_primary: boolean;
      }>;
    }
  >
> {
  if (contacts.length === 0) return [];
  const ids = contacts.map((contact) => contact.id);
  const placeholders = ids.map(() => "?").join(", ");
  const relationResults = await database.batch([
    database.prepare(
      `SELECT ct.contact_id, t.id, t.name, t.slug, t.color
       FROM contact_tags ct JOIN tags t
         ON t.workspace_id = ct.workspace_id AND t.id = ct.tag_id
       WHERE ct.workspace_id = ? AND ct.contact_id IN (${placeholders})
       ORDER BY t.name`,
    ).bind(workspaceId, ...ids),
    database.prepare(
      `SELECT clm.contact_id, cl.id, cl.name, cl.slug, cl.color
       FROM contact_list_memberships clm JOIN contact_lists cl
         ON cl.workspace_id = clm.workspace_id AND cl.id = clm.list_id
       WHERE clm.workspace_id = ? AND clm.status = 'active'
         AND clm.contact_id IN (${placeholders})
       ORDER BY cl.name`,
    ).bind(workspaceId, ...ids),
    database.prepare(
      `SELECT cc.contact_id, co.id, co.name, co.domain, cc.title, cc.is_primary
       FROM company_contacts cc JOIN companies co
         ON co.workspace_id = cc.workspace_id AND co.id = cc.company_id
       WHERE cc.workspace_id = ? AND cc.contact_id IN (${placeholders})
       ORDER BY cc.is_primary DESC, co.name`,
    ).bind(workspaceId, ...ids),
  ]);
  const tagRows = relationResults[0]!;
  const listRows = relationResults[1]!;
  const accountRows = relationResults[2]!;
  const tagsByContact = new Map<
    string,
    Array<{ id: string; name: string; slug: string; color: string }>
  >();
  const listsByContact = new Map<
    string,
    Array<{ id: string; name: string; slug: string; color: string }>
  >();
  const accountsByContact = new Map<
    string,
    Array<{
      id: string;
      name: string;
      domain: string | null;
      title: string | null;
      is_primary: boolean;
    }>
  >();
  for (const row of tagRows.results as Array<{
    contact_id: string;
    id: string;
    name: string;
    slug: string;
    color: string;
  }>) {
    const items = tagsByContact.get(row.contact_id) ?? [];
    items.push({ id: row.id, name: row.name, slug: row.slug, color: row.color });
    tagsByContact.set(row.contact_id, items);
  }
  for (const row of listRows.results as Array<{
    contact_id: string;
    id: string;
    name: string;
    slug: string;
    color: string;
  }>) {
    const items = listsByContact.get(row.contact_id) ?? [];
    items.push({ id: row.id, name: row.name, slug: row.slug, color: row.color });
    listsByContact.set(row.contact_id, items);
  }
  for (const row of accountRows.results as Array<{
    contact_id: string;
    id: string;
    name: string;
    domain: string | null;
    title: string | null;
    is_primary: number;
  }>) {
    const items = accountsByContact.get(row.contact_id) ?? [];
    items.push({
      id: row.id,
      name: row.name,
      domain: row.domain,
      title: row.title,
      is_primary: Boolean(row.is_primary),
    });
    accountsByContact.set(row.contact_id, items);
  }
  return contacts.map((contact) => ({
    ...contact,
    tags: tagsByContact.get(contact.id) ?? [],
    lists: listsByContact.get(contact.id) ?? [],
    accounts: accountsByContact.get(contact.id) ?? [],
  }));
}

async function updateSegmentMemberCount(
  database: D1Database,
  workspaceId: string,
  segmentId: string,
): Promise<void> {
  await database.prepare(
    `UPDATE segments
     SET member_count = (
       SELECT COUNT(*) FROM segment_memberships sm
       WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id
     ), updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  )
    .bind(new Date().toISOString(), workspaceId, segmentId)
    .run();
}

async function refreshSegmentMemberships(
  database: D1Database,
  workspaceId: string,
  segmentId: string,
): Promise<boolean> {
  const segment = await database.prepare(
    `SELECT kind, filter_ast FROM segments WHERE workspace_id = ? AND id = ?`,
  )
    .bind(workspaceId, segmentId)
    .first<{ kind: "static" | "dynamic"; filter_ast: string | null }>();
  if (!segment) return false;
  if (segment.kind === "static") {
    await updateSegmentMemberCount(database, workspaceId, segmentId);
    return true;
  }
  let rawFilter: unknown;
  try {
    rawFilter = segment.filter_ast ? JSON.parse(segment.filter_ast) : null;
  } catch {
    return false;
  }
  const parsed = segmentFilterSchema.safeParse(rawFilter);
  if (!parsed.success) return false;
  const compiled = compileSegmentFilter(workspaceId, parsed.data);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      `DELETE FROM segment_memberships
       WHERE workspace_id = ? AND segment_id = ? AND source = 'dynamic'`,
    ).bind(workspaceId, segmentId),
    database.prepare(
      `INSERT OR IGNORE INTO segment_memberships
       (workspace_id, segment_id, contact_id, source, joined_at)
       SELECT ?, ?, matched.id, 'dynamic', ?
       FROM (${compiled.sql}) matched
       WHERE matched.status != 'archived'`,
    ).bind(workspaceId, segmentId, now, ...compiled.params),
    database.prepare(
      `UPDATE segments
       SET member_count = (
         SELECT COUNT(*) FROM segment_memberships sm
         WHERE sm.workspace_id = segments.workspace_id AND sm.segment_id = segments.id
       ), evaluated_at = ?, updated_at = ?
       WHERE workspace_id = ? AND id = ?`,
    ).bind(now, now, workspaceId, segmentId),
  ]);
  return true;
}

function resourceSlug(value: string, fallbackId: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || `item-${fallbackId.slice(0, 8)}`;
}

async function safeJson(context: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

function validationError(
  context: Parameters<typeof apiError>[0],
  error: z.ZodError,
): Response {
  return apiError(context, 422, "validation_error", "入力内容を確認してください", error.issues);
}

function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseJsonColumns(keys: string[]) {
  return (row: unknown): Record<string, unknown> => {
    if (!isRecord(row)) return {};
    const result = { ...row };
    for (const key of keys) {
      if (typeof result[key] === "string") {
        try {
          result[key] = JSON.parse(result[key]);
        } catch {
          result[key] = null;
        }
      }
    }
    return result;
  };
}

function sanitizeFilename(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 191);
}

async function sha256HexFromBytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomString(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function originAllowed(origin: string, allowedDomains: string[]): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const allowed = domain.toLowerCase();
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  } catch {
    return false;
  }
}

function normalizeDomain(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}

function isValidDomain(value: string): boolean {
  return (
    value === "localhost" ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
  );
}

async function loadPublicTrackingWorkspace(
  database: D1Database,
  workspaceSlug: string,
): Promise<{ id: string; allowedDomains: string[] } | null> {
  const row = await database.prepare(
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

function pagePatternMatches(pageUrl: string, pattern: string): boolean {
  if (pattern === "*") return true;
  let path = pageUrl;
  try {
    const url = new URL(pageUrl);
    path = `${url.pathname}${url.search}`;
  } catch {
    // Use the supplied path as-is.
  }
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(path);
}

function siteTrackingScript(
  trackingEndpoint: string,
  messagesEndpoint: string,
): string {
  return `(() => {
  if (window.kaenma) return;
  const endpoint = ${JSON.stringify(trackingEndpoint)};
  const messagesEndpoint = ${JSON.stringify(messagesEndpoint)};
  const settings = window.kaenmaSettings || {};
  const visitorKey = "kaenma_visitor_" + endpoint.split("/").pop();
  let email = typeof settings.email === "string" ? settings.email : undefined;
  let visitorId = localStorage.getItem(visitorKey) || undefined;

  async function record(type, resourceId, properties = {}) {
    if (settings.consent !== true) return null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consent: true,
          visitorId,
          email,
          type,
          resourceId,
          properties,
        }),
        keepalive: true,
      });
      const payload = await response.json();
      if (payload?.data?.visitorId) {
        visitorId = payload.data.visitorId;
        localStorage.setItem(visitorKey, visitorId);
      }
      return payload?.data || null;
    } catch {
      return null;
    }
  }

  async function loadMessage() {
    if (!visitorId) return;
    try {
      const url = new URL(messagesEndpoint);
      url.searchParams.set("visitorId", visitorId);
      url.searchParams.set("url", window.location.href);
      const response = await fetch(url);
      const payload = await response.json();
      const message = payload?.data?.[0];
      if (!message || sessionStorage.getItem("kaenma_message_" + message.id)) return;
      sessionStorage.setItem("kaenma_message_" + message.id, "shown");

      const container = document.createElement("aside");
      container.setAttribute("role", "status");
      container.style.cssText =
        "position:fixed;right:20px;bottom:20px;max-width:360px;padding:20px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;color:#111827;box-shadow:0 18px 48px rgba(0,0,0,.18);font:14px/1.5 system-ui,sans-serif;z-index:2147483647";
      const close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "メッセージを閉じる");
      close.textContent = "×";
      close.style.cssText =
        "position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:22px;cursor:pointer;color:#6b7280";
      close.addEventListener("click", () => container.remove());
      const title = document.createElement("strong");
      title.textContent = message.headline;
      title.style.cssText = "display:block;padding-right:22px;font-size:16px";
      const body = document.createElement("p");
      body.textContent = message.body;
      body.style.cssText = "margin:8px 0 0;color:#4b5563";
      container.append(close, title);
      if (message.body) container.append(body);
      if (message.cta_url && message.cta_label) {
        const link = document.createElement("a");
        link.href = message.cta_url;
        link.textContent = message.cta_label;
        link.rel = "noopener noreferrer";
        link.style.cssText =
          "display:inline-block;margin-top:14px;padding:8px 12px;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font-weight:600";
        link.addEventListener("click", () => {
          void messageEvent(message.id, "click");
        });
        container.append(link);
      }
      document.body.append(container);
      void messageEvent(message.id, "impression");
    } catch {
      // Tracking must never interrupt the host page.
    }
  }

  function messageEvent(messageId, type) {
    return fetch(messagesEndpoint + "/" + encodeURIComponent(messageId) + "/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId, type }),
      keepalive: true,
    });
  }

  async function page() {
    const result = await record("page_viewed", window.location.href, {
      title: document.title,
      referrer: document.referrer,
    });
    if (result?.identified) await loadMessage();
  }

  window.kaenma = {
    consent() {
      settings.consent = true;
      void page();
    },
    identify(value) {
      email = value;
      void page();
    },
    track(name, properties) {
      return record("custom_event", name, properties);
    },
  };

  if (settings.consent === true) void page();
})();`;
}

async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

function redactFormPayload(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  delete result["turnstileToken"];
  delete result["_website"];
  return result;
}

async function hashIp(value?: string): Promise<string | null> {
  return value ? sha256Hex(value) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 191) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPublicForm(
  name: string,
  definition: Record<string, unknown>,
  actionUrl: string,
): string {
  const configuredFields = Array.isArray(definition["fields"])
    ? definition["fields"].filter(isRecord)
    : [];
  const supported = new Map([
    ["email", { label: "メールアドレス", type: "email", required: true }],
    ["firstName", { label: "名", type: "text", required: false }],
    ["lastName", { label: "姓", type: "text", required: false }],
    ["phone", { label: "電話番号", type: "tel", required: false }],
  ]);
  const fields = configuredFields
    .map((field) => {
      const key = typeof field["key"] === "string" ? field["key"] : "";
      const base = supported.get(key);
      return base
        ? {
            key,
            ...base,
            required: key === "email" || field["required"] === true,
          }
        : null;
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);
  if (!fields.some((field) => field.key === "email")) {
    fields.unshift({
      key: "email",
      label: "メールアドレス",
      type: "email",
      required: true,
    });
  }
  const controls = fields
    .map(
      (field) =>
        `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.key)}" type="${field.type}"${field.required ? " required" : ""}></label>`,
    )
    .join("");
  const endpoint = escapeHtml(actionUrl.split("?")[0] ?? actionUrl);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(name)}</title>
  <style>
    :root{color-scheme:light;font-family:system-ui,sans-serif;color:#111827}
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#fff}
    form{display:grid;gap:16px;max-width:520px;margin:auto}
    h1{margin:0;font-size:24px}label{display:grid;gap:6px;font-size:14px;font-weight:600}
    input{width:100%;height:42px;border:1px solid #d1d5db;border-radius:8px;padding:0 12px;font:inherit}
    button{height:42px;border:0;border-radius:8px;background:#111827;color:#fff;font:inherit;font-weight:700;cursor:pointer}
    p{margin:0;color:#4b5563;font-size:14px}.hidden{position:absolute;left:-9999px}
  </style>
</head>
<body>
  <form id="signup-form">
    <h1>${escapeHtml(name)}</h1>
    ${controls}
    <label class="hidden" aria-hidden="true">Website<input name="_website" tabindex="-1" autocomplete="off"></label>
    <button type="submit">送信する</button>
    <p id="result" role="status"></p>
  </form>
  <script>
    document.getElementById("signup-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const result = document.getElementById("result");
      button.disabled = true;
      result.textContent = "送信しています…";
      try {
        const payload = Object.fromEntries(new FormData(form));
        payload.idempotencyKey = crypto.randomUUID();
        const response = await fetch("${endpoint}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "送信できませんでした");
        result.textContent = body?.data?.message || "ありがとうございます。";
        form.reset();
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : "送信できませんでした";
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function formEmbedScript(formUrl: string, formName: string, style: string): string {
  return `(() => {
  const current = document.currentScript;
  const frame = document.createElement("iframe");
  frame.src = ${JSON.stringify(formUrl)};
  frame.title = ${JSON.stringify(formName)};
  frame.loading = "lazy";
  frame.style.cssText = "border:0;background:#fff;width:100%";
  const style = ${JSON.stringify(style)};

  if (style === "inline") {
    frame.style.height = "520px";
    current?.parentNode?.insertBefore(frame, current.nextSibling);
    return;
  }

  if (style === "floating-bar") {
    frame.style.cssText += ";position:fixed;left:0;bottom:0;height:230px;box-shadow:0 -10px 32px rgba(0,0,0,.14);z-index:2147483646";
    document.body.append(frame);
    return;
  }

  if (style === "floating-box") {
    frame.style.cssText += ";position:fixed;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));height:480px;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.18);z-index:2147483646";
    document.body.append(frame);
    return;
  }

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", ${JSON.stringify(formName)});
  overlay.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.45);z-index:2147483646";
  frame.style.cssText += ";max-width:560px;height:540px;border-radius:14px";
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "フォームを閉じる");
  close.textContent = "×";
  close.style.cssText = "position:absolute;right:24px;top:16px;border:0;background:transparent;color:#fff;font-size:32px;cursor:pointer";
  close.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.append(frame, close);
  document.body.append(overlay);
})();`;
}

const transparentGif = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0,
  59,
]);

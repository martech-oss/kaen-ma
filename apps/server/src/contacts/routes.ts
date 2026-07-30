import type { Hono } from "hono";

import { ContactRepository, writeAuditLog } from "@kaenma/database";
import { contactCreateSchema, contactUpdateSchema } from "@kaenma/shared";

import type { AppEnvironment } from "../env";
import { numberQuery, parseJsonColumns, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import {
  createContact as createContactService,
  listContacts as listContactsService,
} from "./service";

export function registerContactRoutes(api: Hono<AppEnvironment>): void {
  api.get("/contacts", async (context) => {
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
    const page = await listContactsService(context.get("database"), context.get("workspace"), {
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
        ? {
            sort: sort as "createdAt" | "updatedAt" | "score" | "name" | "email",
          }
        : {}),
      ...(direction === "asc" || direction === "desc" ? { direction } : {}),
    });
    return context.json({
      data: page.items,
      meta: {
        total: page.total,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        requestId: context.get("requestId"),
      },
    });
  });

  api.get("/contacts/:id", async (context) => {
    const repository = new ContactRepository(context.get("database"), context.get("workspace"));
    const contact = await repository.getContact(context.req.param("id"));
    return contact
      ? context.json({ data: contact })
      : apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
  });

  api.get("/contacts/:id/timeline", async (context) => {
    const workspace = context.get("workspace");
    const exists = await context
      .get("database")
      .prepare("SELECT id FROM contacts WHERE workspace_id = ? AND id = ?")
      .bind(workspace.workspaceId, context.req.param("id"))
      .first();
    if (!exists) return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    const result = await context
      .get("database")
      .prepare(
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
    try {
      const contact = await createContactService(
        context.get("database"),
        context.get("workspace"),
        parsed.data,
      );
      context.executionCtx.waitUntil(
        writeAuditLog(context.get("database"), context.get("workspace"), {
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
    const repository = new ContactRepository(context.get("database"), context.get("workspace"));
    const existing = await repository.getContact(context.req.param("id"));
    if (!existing) {
      return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    }
    if (existing.status === "archived") {
      return apiError(context, 409, "contact_archived", "アーカイブ済みの連絡先は編集できません");
    }
    const contact = await repository.updateContact(context.req.param("id"), parsed.data);
    if (!contact) return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    return context.json({ data: contact });
  });

  api.delete("/contacts/:id", requireRole("admin"), async (context) => {
    const repository = new ContactRepository(context.get("database"), context.get("workspace"));
    const archived = await repository.archiveContact(context.req.param("id"));
    return archived
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
  });
}

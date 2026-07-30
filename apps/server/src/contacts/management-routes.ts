import { Hono } from "hono";
import * as z from "zod";

import { ContactRepository, uuidv7, type DrizzleRawStatement } from "@kaenma/database";

import { type AppEnvironment } from "../env";
import { recordContactEvent } from "../events/service";
import { parseJsonColumns, resourceSlug, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import { updateSegmentMemberCount } from "../segments/routes";

export function registerContactManagementRoutes(api: Hono<AppEnvironment>): void {
  api.get("/contact-options", async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const optionResults = await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `SELECT t.id, t.name, t.slug, t.color, COUNT(ct.contact_id) AS contact_count
         FROM tags t
         LEFT JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         WHERE t.workspace_id = ?
         GROUP BY t.id ORDER BY t.name`,
        )
        .bind(workspaceId),
      context
        .get("database")
        .prepare(
          `SELECT cl.id, cl.name, cl.slug, cl.description, cl.color,
                COUNT(CASE WHEN clm.status = 'active' THEN 1 END) AS contact_count
         FROM contact_lists cl
         LEFT JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         WHERE cl.workspace_id = ?
         GROUP BY cl.id ORDER BY cl.name`,
        )
        .bind(workspaceId),
      context
        .get("database")
        .prepare(
          `SELECT id, name, slug, kind, filter_ast, member_count, evaluated_at
         FROM segments WHERE workspace_id = ? ORDER BY name`,
        )
        .bind(workspaceId),
      context
        .get("database")
        .prepare(
          `SELECT stage, COUNT(*) AS contact_count
         FROM contacts
         WHERE workspace_id = ? AND status != 'archived'
         GROUP BY stage ORDER BY stage`,
        )
        .bind(workspaceId),
      context
        .get("database")
        .prepare(
          `SELECT co.id, co.name, co.domain,
                COUNT(CASE WHEN c.status != 'archived' THEN 1 END) AS contact_count
         FROM companies co
         LEFT JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         LEFT JOIN contacts c
           ON c.workspace_id = cc.workspace_id AND c.id = cc.contact_id
         WHERE co.workspace_id = ?
         GROUP BY co.id ORDER BY co.name`,
        )
        .bind(workspaceId),
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
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#64748b"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const id = uuidv7();
    const slug = resourceSlug(parsed.data.name, id);
    try {
      await context
        .get("database")
        .prepare(
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
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#6366f1"),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const id = uuidv7();
    const slug = resourceSlug(parsed.data.name, id);
    const now = new Date().toISOString();
    try {
      await context
        .get("database")
        .prepare(
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
    const repository = new ContactRepository(context.get("database"), context.get("workspace"));
    const contact = await repository.getContact(contactId);
    if (!contact) return apiError(context, 404, "contact_not_found", "連絡先が見つかりません");
    const profileResults = await context.get("database").batch([
      context
        .get("database")
        .prepare(
          `SELECT t.id, t.name, t.slug, t.color
         FROM tags t JOIN contact_tags ct
           ON ct.workspace_id = t.workspace_id AND ct.tag_id = t.id
         WHERE ct.workspace_id = ? AND ct.contact_id = ?
         ORDER BY t.name`,
        )
        .bind(workspaceId, contactId),
      context
        .get("database")
        .prepare(
          `SELECT cl.id, cl.name, cl.slug, cl.color, clm.status, clm.updated_at
         FROM contact_lists cl JOIN contact_list_memberships clm
           ON clm.workspace_id = cl.workspace_id AND clm.list_id = cl.id
         WHERE clm.workspace_id = ? AND clm.contact_id = ?
         ORDER BY cl.name`,
        )
        .bind(workspaceId, contactId),
      context
        .get("database")
        .prepare(
          `SELECT s.id, s.name, s.kind, sm.source, sm.joined_at
         FROM segments s JOIN segment_memberships sm
           ON sm.workspace_id = s.workspace_id AND sm.segment_id = s.id
         WHERE sm.workspace_id = ? AND sm.contact_id = ?
         ORDER BY s.name`,
        )
        .bind(workspaceId, contactId),
      context
        .get("database")
        .prepare(
          `SELECT co.id, co.name, co.domain, cc.title, cc.is_primary
         FROM companies co JOIN company_contacts cc
           ON cc.workspace_id = co.workspace_id AND cc.company_id = co.id
         WHERE cc.workspace_id = ? AND cc.contact_id = ?
         ORDER BY cc.is_primary DESC, co.name`,
        )
        .bind(workspaceId, contactId),
      context
        .get("database")
        .prepare(
          `SELECT id, delta, total, reason, created_at
         FROM score_events
         WHERE workspace_id = ? AND contact_id = ?
         ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(workspaceId, contactId),
      context
        .get("database")
        .prepare(
          `SELECT id, type, resource_type, resource_id, properties, occurred_at
         FROM contact_events
         WHERE workspace_id = ? AND contact_id = ?
         ORDER BY occurred_at DESC, id DESC LIMIT 100`,
        )
        .bind(workspaceId, contactId),
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
    const result = await context
      .get("database")
      .prepare(
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
    const result = await context
      .get("database")
      .prepare(
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
    const result = await context
      .get("database")
      .prepare(
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
    const result = await context
      .get("database")
      .prepare(
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
    const result = await context
      .get("database")
      .prepare(
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
    await updateSegmentMemberCount(context.get("database"), workspaceId, parsed.data.segmentId);
    await recordContactEvent(context.get("database"), {
      workspaceId,
      contactId: context.req.param("id"),
      type: "segment_joined",
      resourceType: "segment",
      resourceId: parsed.data.segmentId,
    });
    return context.json({ data: { assigned: true } }, 201);
  });

  api.delete("/contacts/:id/segments/:segmentId", requireRole("marketer"), async (context) => {
    const workspaceId = context.get("workspace").workspaceId;
    const result = await context
      .get("database")
      .prepare(
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
        context.get("database"),
        workspaceId,
        context.req.param("segmentId"),
      );
    }
    return context.json({ data: { removed: true } });
  });

  api.post("/contacts/:id/score", requireRole("marketer"), async (context) => {
    const parsed = z
      .object({
        delta: z
          .number()
          .int()
          .min(-10_000)
          .max(10_000)
          .refine((value) => value !== 0),
        reason: z.string().trim().min(1).max(500),
      })
      .safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const workspaceId = context.get("workspace").workspaceId;
    const contactId = context.req.param("id");
    const now = new Date().toISOString();
    const result = await context
      .get("database")
      .prepare(
        `UPDATE contacts SET score = score + ?, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(parsed.data.delta, now, workspaceId, contactId)
      .run();
    if (result.meta.changes === 0) {
      return apiError(context, 409, "score_not_adjustable", "スコアを変更できませんでした");
    }
    await context
      .get("database")
      .prepare(
        `INSERT INTO score_events
       (id, workspace_id, contact_id, delta, total, reason, created_at)
       SELECT ?, workspace_id, id, ?, score, ?, ?
       FROM contacts WHERE workspace_id = ? AND id = ?`,
      )
      .bind(uuidv7(), parsed.data.delta, parsed.data.reason, now, workspaceId, contactId)
      .run();
    const contact = await new ContactRepository(
      context.get("database"),
      context.get("workspace"),
    ).getContact(contactId);
    return context.json({ data: contact });
  });

  api.post("/contacts/:id/restore", requireRole("admin"), async (context) => {
    const restored = await new ContactRepository(
      context.get("database"),
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
        action: z.enum(["archive", "restore", "add_tag", "remove_tag", "add_list", "remove_list"]),
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
    let statement: DrizzleRawStatement;
    if (parsed.data.action === "archive" || parsed.data.action === "restore") {
      const archived = parsed.data.action === "archive";
      statement = context
        .get("database")
        .prepare(
          `UPDATE contacts
         SET status = ?, archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id IN (${placeholders})`,
        )
        .bind(
          archived ? "archived" : "active",
          archived ? now : null,
          now,
          workspaceId,
          ...contactIds,
        );
    } else if (parsed.data.action === "add_tag") {
      statement = context
        .get("database")
        .prepare(
          `INSERT OR IGNORE INTO contact_tags (workspace_id, contact_id, tag_id, created_at)
         SELECT c.workspace_id, c.id, t.id, ?
         FROM contacts c JOIN tags t ON t.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.status != 'archived'
           AND c.id IN (${placeholders}) AND t.id = ?`,
        )
        .bind(now, workspaceId, ...contactIds, parsed.data.resourceId);
    } else if (parsed.data.action === "remove_tag") {
      statement = context
        .get("database")
        .prepare(
          `DELETE FROM contact_tags
         WHERE workspace_id = ? AND contact_id IN (${placeholders}) AND tag_id = ?
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = contact_tags.workspace_id
               AND c.id = contact_tags.contact_id AND c.status != 'archived'
           )`,
        )
        .bind(workspaceId, ...contactIds, parsed.data.resourceId);
    } else if (parsed.data.action === "add_list") {
      statement = context
        .get("database")
        .prepare(
          `INSERT INTO contact_list_memberships
         (workspace_id, list_id, contact_id, status, source, created_at, updated_at)
         SELECT c.workspace_id, cl.id, c.id, 'active', 'bulk', ?, ?
         FROM contacts c JOIN contact_lists cl ON cl.workspace_id = c.workspace_id
         WHERE c.workspace_id = ? AND c.status != 'archived'
           AND c.id IN (${placeholders}) AND cl.id = ?
         ON CONFLICT(workspace_id, list_id, contact_id)
         DO UPDATE SET status = 'active', source = 'bulk', updated_at = excluded.updated_at`,
        )
        .bind(now, now, workspaceId, ...contactIds, parsed.data.resourceId);
    } else {
      statement = context
        .get("database")
        .prepare(
          `DELETE FROM contact_list_memberships
         WHERE workspace_id = ? AND contact_id IN (${placeholders}) AND list_id = ?
           AND EXISTS (
             SELECT 1 FROM contacts c
             WHERE c.workspace_id = contact_list_memberships.workspace_id
               AND c.id = contact_list_memberships.contact_id AND c.status != 'archived'
           )`,
        )
        .bind(workspaceId, ...contactIds, parsed.data.resourceId);
    }
    const result = await statement.run();
    return context.json({ data: { updated: result.meta.changes } });
  });
}

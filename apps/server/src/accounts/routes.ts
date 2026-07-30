import { Hono } from "hono";
import * as z from "zod";

import { AccountRepository, writeAuditLog } from "@kaenma/database";
import { accountCreateSchema, accountUpdateSchema } from "@kaenma/shared";

import { type AppEnvironment } from "../env";
import { numberQuery, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

export function registerAccountRoutes(api: Hono<AppEnvironment>): void {
  api.get("/accounts", async (context) => {
    const repository = new AccountRepository(context.get("database"), context.get("workspace"));
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
    const repository = new AccountRepository(context.get("database"), context.get("workspace"));
    const account = await repository.getAccount(context.req.param("id"));
    if (!account) {
      return apiError(context, 404, "account_not_found", "アカウントが見つかりません");
    }
    const contacts = await context
      .get("database")
      .prepare(
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
    const repository = new AccountRepository(context.get("database"), context.get("workspace"));
    try {
      const account = await repository.createAccount(parsed.data);
      context.executionCtx.waitUntil(
        writeAuditLog(context.get("database"), context.get("workspace"), {
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
    const repository = new AccountRepository(context.get("database"), context.get("workspace"));
    try {
      const account = await repository.updateAccount(context.req.param("id"), parsed.data);
      return account
        ? context.json({ data: account })
        : apiError(context, 404, "account_not_found", "アカウントが見つかりません");
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

  api.post("/accounts/:id/contacts", requireRole("marketer"), async (context) => {
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
    const relationExists = await context
      .get("database")
      .prepare(
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
    const assign = context
      .get("database")
      .prepare(
        `INSERT INTO company_contacts
         (workspace_id, company_id, contact_id, title, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, company_id, contact_id)
         DO UPDATE SET title = excluded.title, is_primary = excluded.is_primary`,
      )
      .bind(
        workspaceId,
        accountId,
        parsed.data.contactId,
        parsed.data.title ?? null,
        parsed.data.isPrimary ? 1 : 0,
        now,
      );
    if (parsed.data.isPrimary) {
      await context.get("database").batch([
        context
          .get("database")
          .prepare(
            `UPDATE company_contacts SET is_primary = 0
             WHERE workspace_id = ? AND contact_id = ?`,
          )
          .bind(workspaceId, parsed.data.contactId),
        assign,
      ]);
    } else {
      await assign.run();
    }
    return context.json({ data: { assigned: true } }, 201);
  });

  api.delete("/accounts/:id/contacts/:contactId", requireRole("marketer"), async (context) => {
    const result = await context
      .get("database")
      .prepare(
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
      : apiError(context, 404, "account_contact_not_found", "アカウントとの関連が見つかりません");
  });
}

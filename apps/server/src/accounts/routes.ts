import { Hono } from "hono";
import * as z from "zod";

import { accountCreateSchema, accountUpdateSchema } from "@kaenma/shared";

import { type AppEnvironment } from "../env";
import { numberQuery, safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import {
  AccountConflictError,
  assignAccountContact,
  createAccount,
  getAccountDetail,
  listAccounts,
  removeAccountContact,
  updateAccount,
} from "./service";

const conflictMessage = "同じドメインのアカウントが既に存在します";

/**
 * REST surface for accounts, kept for the SDK, MCP server and OpenAPI document.
 * The admin UI talks to the typed oRPC procedures in ./router instead; both call
 * the same service functions.
 */
export function registerAccountRoutes(api: Hono<AppEnvironment>): void {
  api.get("/accounts", async (context) => {
    const query = context.req.query("q")?.trim();
    const limit = numberQuery(context.req.query("limit"));
    const accounts = await listAccounts(context.get("database"), context.get("workspace"), {
      ...(query ? { query } : {}),
      ...(limit === undefined ? {} : { limit }),
    });
    return context.json({ data: accounts });
  });

  api.get("/accounts/:id", async (context) => {
    const account = await getAccountDetail(
      context.get("database"),
      context.get("workspace"),
      context.req.param("id"),
    );
    return account
      ? context.json({ data: account })
      : apiError(context, 404, "account_not_found", "アカウントが見つかりません");
  });

  api.post("/accounts", requireRole("marketer"), async (context) => {
    const parsed = accountCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    try {
      const account = await createAccount(
        context.get("database"),
        context.get("workspace"),
        parsed.data,
        context.executionCtx,
      );
      return context.json({ data: account }, 201);
    } catch (error) {
      if (!(error instanceof AccountConflictError)) throw error;
      return apiError(context, 409, "account_conflict", conflictMessage, error.message);
    }
  });

  api.patch("/accounts/:id", requireRole("marketer"), async (context) => {
    const parsed = accountUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    try {
      const account = await updateAccount(
        context.get("database"),
        context.get("workspace"),
        context.req.param("id"),
        parsed.data,
      );
      return account
        ? context.json({ data: account })
        : apiError(context, 404, "account_not_found", "アカウントが見つかりません");
    } catch (error) {
      if (!(error instanceof AccountConflictError)) throw error;
      return apiError(context, 409, "account_conflict", conflictMessage, error.message);
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
    const assigned = await assignAccountContact(context.get("database"), context.get("workspace"), {
      id: context.req.param("id"),
      ...parsed.data,
    });
    return assigned
      ? context.json({ data: { assigned: true } }, 201)
      : apiError(
          context,
          404,
          "account_contact_not_found",
          "アカウントまたは連絡先が見つかりません",
        );
  });

  api.delete("/accounts/:id/contacts/:contactId", requireRole("marketer"), async (context) => {
    const removed = await removeAccountContact(context.get("database"), context.get("workspace"), {
      id: context.req.param("id"),
      contactId: context.req.param("contactId"),
    });
    return removed
      ? context.json({ data: { removed: true } })
      : apiError(context, 404, "account_contact_not_found", "アカウントとの関連が見つかりません");
  });
}

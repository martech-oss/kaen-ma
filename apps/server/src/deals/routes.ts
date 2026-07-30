import { Hono } from "hono";
import * as z from "zod";

import {
  dealCreateSchema,
  dealMoveSchema,
  dealTaskCreateSchema,
  dealTaskUpdateSchema,
  dealUpdateSchema,
} from "@kaenma/shared/deals";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";
import {
  archiveDeal,
  createDeal,
  createDealTask,
  deleteDealTask,
  getDealDetail,
  getDealOptions,
  listDeals,
  moveDeal,
  updateDeal,
  updateDealTask,
} from "./service";

const dealListQuerySchema = z.object({
  pipelineId: z.string().min(1).optional(),
  status: z.enum(["open", "won", "lost", "all"]).default("open"),
  q: z.string().trim().max(191).optional(),
});

const dealNotFound = "商談が見つかりません";
const taskNotFound = "タスクが見つかりません";
const assigneeNotFound = "担当者が見つかりません";

/**
 * REST surface for deals, kept for the SDK, MCP server and OpenAPI document.
 * The admin UI uses the typed oRPC procedures in ./router; both call ./service.
 */
export function registerDealRoutes(api: Hono<AppEnvironment>): void {
  api.get("/deal-options", async (context) => {
    const options = await getDealOptions(context.get("database"), context.get("workspace"));
    return context.json({ data: options });
  });

  api.get("/deals", async (context) => {
    const parsed = dealListQuerySchema.safeParse({
      pipelineId: context.req.query("pipelineId"),
      status: context.req.query("status"),
      q: context.req.query("q"),
    });
    if (!parsed.success) return validationError(context, parsed.error);
    const outcome = await listDeals(context.get("database"), context.get("workspace"), parsed.data);
    return outcome.kind === "pipeline_not_found"
      ? apiError(context, 404, "deal_pipeline_not_found", "パイプラインが見つかりません")
      : context.json({ data: outcome.data });
  });

  api.get("/deals/:id", async (context) => {
    const detail = await getDealDetail(
      context.get("database"),
      context.get("workspace"),
      context.req.param("id"),
    );
    return detail
      ? context.json({ data: detail })
      : apiError(context, 404, "deal_not_found", dealNotFound);
  });

  api.post("/deals", requireRole("marketer"), async (context) => {
    const parsed = dealCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const outcome = await createDeal(
      context.get("database"),
      context.get("workspace"),
      parsed.data,
      context.executionCtx,
    );
    if (outcome.kind === "invalid_reference") {
      return apiError(context, 422, "invalid_deal_reference", outcome.message);
    }
    if (outcome.kind === "not_found") {
      return apiError(context, 404, "deal_not_found", dealNotFound);
    }
    return context.json({ data: outcome.deal }, 201);
  });

  api.patch("/deals/:id", requireRole("marketer"), async (context) => {
    const parsed = dealUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const outcome = await updateDeal(
      context.get("database"),
      context.get("workspace"),
      context.req.param("id"),
      parsed.data,
      context.executionCtx,
    );
    if (outcome.kind === "not_found") {
      return apiError(context, 404, "deal_not_found", dealNotFound);
    }
    if (outcome.kind === "invalid_reference") {
      return apiError(context, 422, "invalid_deal_reference", outcome.message);
    }
    return context.json({ data: outcome.deal });
  });

  api.post("/deals/:id/move", requireRole("marketer"), async (context) => {
    const parsed = dealMoveSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const outcome = await moveDeal(
      context.get("database"),
      context.get("workspace"),
      context.req.param("id"),
      parsed.data.stageId,
      context.executionCtx,
    );
    if (outcome.kind === "not_found") {
      return apiError(context, 404, "deal_not_found", dealNotFound);
    }
    if (outcome.kind === "invalid_stage") {
      return apiError(
        context,
        422,
        "invalid_deal_stage",
        "移動先ステージがパイプラインに存在しません",
      );
    }
    return context.json({ data: outcome.deal });
  });

  api.post("/deals/:id/archive", requireRole("marketer"), async (context) => {
    const archived = await archiveDeal(
      context.get("database"),
      context.get("workspace"),
      context.req.param("id"),
      context.executionCtx,
    );
    return archived
      ? context.json({ data: { archived: true } })
      : apiError(context, 404, "deal_not_found", dealNotFound);
  });

  api.post("/deals/:id/tasks", requireRole("marketer"), async (context) => {
    const parsed = dealTaskCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const outcome = await createDealTask(
      context.get("database"),
      context.get("workspace"),
      context.req.param("id"),
      parsed.data,
    );
    if (outcome.kind === "not_found") {
      return apiError(context, 404, "deal_not_found", dealNotFound);
    }
    if (outcome.kind === "invalid_assignee") {
      return apiError(context, 422, "invalid_deal_task_assignee", assigneeNotFound);
    }
    return context.json({ data: outcome.task }, 201);
  });

  api.patch("/deals/:dealId/tasks/:taskId", requireRole("marketer"), async (context) => {
    const parsed = dealTaskUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const outcome = await updateDealTask(
      context.get("database"),
      context.get("workspace"),
      context.req.param("dealId"),
      context.req.param("taskId"),
      parsed.data,
    );
    if (outcome.kind === "not_found") {
      return apiError(context, 404, "deal_task_not_found", taskNotFound);
    }
    if (outcome.kind === "invalid_assignee") {
      return apiError(context, 422, "invalid_deal_task_assignee", assigneeNotFound);
    }
    return context.json({ data: outcome.task });
  });

  api.delete("/deals/:dealId/tasks/:taskId", requireRole("marketer"), async (context) => {
    const removed = await deleteDealTask(
      context.get("database"),
      context.get("workspace"),
      context.req.param("dealId"),
      context.req.param("taskId"),
    );
    return removed
      ? context.json({ data: { removed: true } })
      : apiError(context, 404, "deal_task_not_found", taskNotFound);
  });
}

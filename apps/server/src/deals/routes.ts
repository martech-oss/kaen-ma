import { Hono } from "hono";
import * as z from "zod";

import {
  uuidv7,
  writeAuditLog,
  type DrizzleRawStatement,
  type KaenmaDatabase,
} from "@kaenma/database";
import {
  dealCreateSchema,
  dealMoveSchema,
  dealTaskCreateSchema,
  dealTaskUpdateSchema,
  dealUpdateSchema,
  type DealCreate,
} from "@kaenma/shared/deals";

import { type AppEnvironment } from "../env";
import { safeJson, validationError } from "../http/helpers";
import { apiError, requireRole } from "../middleware";

const dealListQuerySchema = z.object({
  pipelineId: z.string().min(1).optional(),
  status: z.enum(["open", "won", "lost", "all"]).default("open"),
  q: z.string().trim().max(191).optional(),
});

const defaultStages = [
  { name: "新規", color: "#64748b", probability: 10 },
  { name: "連絡済み", color: "#3b82f6", probability: 25 },
  { name: "提案", color: "#8b5cf6", probability: 50 },
  { name: "交渉", color: "#f59e0b", probability: 75 },
  { name: "最終確認", color: "#10b981", probability: 90 },
] as const;

interface PipelineRow {
  id: string;
  name: string;
  is_default: number;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
}

interface DealRow extends Record<string, unknown> {
  id: string;
  workspace_id: string;
  pipeline_id: string;
  pipeline_name: string;
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_position: number;
  stage_probability: number;
  name: string;
  value: number;
  currency: string;
  status: "open" | "won" | "lost";
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  contact_id: string | null;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  account_id: string | null;
  account_name: string | null;
  expected_close_date: string | null;
  description: string;
  won_at: string | null;
  lost_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  open_task_count: number;
  next_task_at: string | null;
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  deal_id: string;
  type: "task" | "call" | "email" | "meeting";
  title: string;
  notes: string;
  due_at: string | null;
  status: "open" | "completed";
  assigned_user_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function registerDealRoutes(api: Hono<AppEnvironment>): void {
  api.get("/deal-options", async (context) => {
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    await ensureDefaultPipeline(database, workspaceId);
    const optionResults = await database.batch([
      database
        .prepare(
          `SELECT id, name, is_default
             FROM deal_pipelines
             WHERE workspace_id = ? AND archived_at IS NULL
             ORDER BY is_default DESC, name ASC`,
        )
        .bind(workspaceId),
      database
        .prepare(
          `SELECT id, pipeline_id, name, color, position, probability
             FROM deal_stages
             WHERE workspace_id = ?
             ORDER BY pipeline_id, position`,
        )
        .bind(workspaceId),
      database
        .prepare(
          `SELECT id, email, first_name, last_name
             FROM contacts
             WHERE workspace_id = ? AND status != 'archived'
             ORDER BY COALESCE(last_name, first_name, email, id) ASC
             LIMIT 500`,
        )
        .bind(workspaceId),
      database
        .prepare(
          `SELECT id, name, domain
             FROM companies
             WHERE workspace_id = ?
             ORDER BY name ASC
             LIMIT 500`,
        )
        .bind(workspaceId),
      database
        .prepare(
          `SELECT u.id, u.name, u.email
             FROM member m
             JOIN user u ON u.id = m.user_id
             WHERE m.organization_id = ?
             ORDER BY u.name ASC, u.email ASC`,
        )
        .bind(workspaceId),
    ] as const);
    const pipelineResult = optionResults[0]!;
    const stageResult = optionResults[1]!;
    const contactResult = optionResults[2]!;
    const accountResult = optionResults[3]!;
    const memberResult = optionResults[4]!;

    const stagesByPipeline = new Map<string, StageRow[]>();
    for (const stage of stageResult.results as StageRow[]) {
      const stages = stagesByPipeline.get(stage.pipeline_id) ?? [];
      stages.push(stage);
      stagesByPipeline.set(stage.pipeline_id, stages);
    }

    return context.json({
      data: {
        pipelines: (pipelineResult.results as PipelineRow[]).map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          isDefault: Boolean(pipeline.is_default),
          stages: (stagesByPipeline.get(pipeline.id) ?? []).map(serializeStage),
        })),
        contacts: contactResult.results,
        accounts: accountResult.results,
        members: memberResult.results,
      },
    });
  });

  api.get("/deals", async (context) => {
    const parsed = dealListQuerySchema.safeParse({
      pipelineId: context.req.query("pipelineId"),
      status: context.req.query("status"),
      q: context.req.query("q"),
    });
    if (!parsed.success) return validationError(context, parsed.error);

    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    const defaultPipelineId = await ensureDefaultPipeline(database, workspaceId);
    const pipelineId = parsed.data.pipelineId ?? defaultPipelineId;
    if (!(await pipelineExists(database, workspaceId, pipelineId))) {
      return apiError(context, 404, "deal_pipeline_not_found", "パイプラインが見つかりません");
    }

    const conditions = ["d.workspace_id = ?", "d.pipeline_id = ?", "d.archived_at IS NULL"];
    const bindings: unknown[] = [workspaceId, pipelineId];
    if (parsed.data.status !== "all") {
      conditions.push("d.status = ?");
      bindings.push(parsed.data.status);
    }
    if (parsed.data.q) {
      conditions.push(
        `(d.name LIKE ? OR c.email LIKE ? OR c.first_name LIKE ?
          OR c.last_name LIKE ? OR co.name LIKE ?)`,
      );
      const query = `%${parsed.data.q}%`;
      bindings.push(query, query, query, query, query);
    }

    const [dealResult, summary] = await Promise.all([
      database
        .prepare(`${dealSelectSql} WHERE ${conditions.join(" AND ")}
          ORDER BY ds.position ASC, d.updated_at DESC`)
        .bind(...bindings)
        .all<DealRow>(),
      database
        .prepare(
          `SELECT
             COUNT(CASE WHEN status = 'open' THEN 1 END) AS open_count,
             COALESCE(SUM(CASE WHEN status = 'open' THEN value ELSE 0 END), 0) AS open_value,
             COUNT(CASE WHEN status = 'won' THEN 1 END) AS won_count,
             COALESCE(SUM(CASE WHEN status = 'won' THEN value ELSE 0 END), 0) AS won_value,
             COUNT(CASE WHEN status = 'lost' THEN 1 END) AS lost_count
           FROM deals
           WHERE workspace_id = ? AND pipeline_id = ? AND archived_at IS NULL`,
        )
        .bind(workspaceId, pipelineId)
        .first<{
          open_count: number;
          open_value: number;
          won_count: number;
          won_value: number;
          lost_count: number;
        }>(),
    ]);

    return context.json({
      data: {
        items: dealResult.results.map(serializeDeal),
        summary: {
          openCount: Number(summary?.open_count ?? 0),
          openValue: Number(summary?.open_value ?? 0),
          wonCount: Number(summary?.won_count ?? 0),
          wonValue: Number(summary?.won_value ?? 0),
          lostCount: Number(summary?.lost_count ?? 0),
        },
      },
    });
  });

  api.get("/deals/:id", async (context) => {
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    const deal = await getDeal(database, workspaceId, context.req.param("id"));
    if (!deal) return apiError(context, 404, "deal_not_found", "商談が見つかりません");
    const tasks = await database
      .prepare(
        `SELECT dt.*, u.name AS assignee_name, u.email AS assignee_email
         FROM deal_tasks dt
         LEFT JOIN user u ON u.id = dt.assigned_user_id
         WHERE dt.workspace_id = ? AND dt.deal_id = ?
         ORDER BY
           CASE WHEN dt.status = 'open' THEN 0 ELSE 1 END,
           CASE WHEN dt.due_at IS NULL THEN 1 ELSE 0 END,
           dt.due_at ASC,
           dt.created_at DESC`,
      )
      .bind(workspaceId, deal.id)
      .all<TaskRow>();
    return context.json({
      data: {
        deal: serializeDeal(deal),
        tasks: tasks.results.map(serializeTask),
      },
    });
  });

  api.post("/deals", requireRole("marketer"), async (context) => {
    const parsed = dealCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const database = context.get("database");
    const workspace = context.get("workspace");
    const referenceError = await validateDealReferences(
      database,
      workspace.workspaceId,
      parsed.data,
    );
    if (referenceError) {
      return apiError(context, 422, "invalid_deal_reference", referenceError);
    }

    const id = uuidv7();
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO deals (
           id, workspace_id, pipeline_id, stage_id, name, value, currency, status,
           owner_user_id, contact_id, account_id, expected_close_date, description,
           won_at, lost_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        workspace.workspaceId,
        parsed.data.pipelineId,
        parsed.data.stageId,
        parsed.data.name,
        parsed.data.value,
        parsed.data.currency,
        parsed.data.status,
        parsed.data.ownerUserId ?? null,
        parsed.data.contactId ?? null,
        parsed.data.accountId ?? null,
        parsed.data.expectedCloseDate ?? null,
        parsed.data.description,
        parsed.data.status === "won" ? now : null,
        parsed.data.status === "lost" ? now : null,
        now,
        now,
      )
      .run();
    context.executionCtx.waitUntil(
      writeAuditLog(database, workspace, {
        action: "deal.create",
        resourceType: "deal",
        resourceId: id,
      }),
    );
    const deal = await getDeal(database, workspace.workspaceId, id);
    return context.json({ data: serializeDeal(deal!) }, 201);
  });

  api.patch("/deals/:id", requireRole("marketer"), async (context) => {
    const parsed = dealUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const database = context.get("database");
    const workspace = context.get("workspace");
    const current = await getDeal(database, workspace.workspaceId, context.req.param("id"));
    if (!current) return apiError(context, 404, "deal_not_found", "商談が見つかりません");

    const merged: DealCreate = {
      name: parsed.data.name ?? current.name,
      pipelineId: parsed.data.pipelineId ?? current.pipeline_id,
      stageId: parsed.data.stageId ?? current.stage_id,
      value: parsed.data.value ?? Number(current.value),
      currency: parsed.data.currency ?? current.currency,
      status: parsed.data.status ?? current.status,
      ownerUserId:
        parsed.data.ownerUserId === undefined ? current.owner_user_id : parsed.data.ownerUserId,
      contactId: parsed.data.contactId === undefined ? current.contact_id : parsed.data.contactId,
      accountId: parsed.data.accountId === undefined ? current.account_id : parsed.data.accountId,
      expectedCloseDate:
        parsed.data.expectedCloseDate === undefined
          ? current.expected_close_date
          : parsed.data.expectedCloseDate,
      description: parsed.data.description ?? current.description,
    };
    const referenceError = await validateDealReferences(database, workspace.workspaceId, merged);
    if (referenceError) {
      return apiError(context, 422, "invalid_deal_reference", referenceError);
    }

    const now = new Date().toISOString();
    const wonAt =
      merged.status === "won" ? (current.status === "won" ? current.won_at : now) : null;
    const lostAt =
      merged.status === "lost" ? (current.status === "lost" ? current.lost_at : now) : null;
    await database
      .prepare(
        `UPDATE deals SET
           pipeline_id = ?, stage_id = ?, name = ?, value = ?, currency = ?, status = ?,
           owner_user_id = ?, contact_id = ?, account_id = ?, expected_close_date = ?,
           description = ?, won_at = ?, lost_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(
        merged.pipelineId,
        merged.stageId,
        merged.name,
        merged.value,
        merged.currency,
        merged.status,
        merged.ownerUserId ?? null,
        merged.contactId ?? null,
        merged.accountId ?? null,
        merged.expectedCloseDate ?? null,
        merged.description,
        wonAt,
        lostAt,
        now,
        workspace.workspaceId,
        current.id,
      )
      .run();
    context.executionCtx.waitUntil(
      writeAuditLog(database, workspace, {
        action: current.status === merged.status ? "deal.update" : "deal.status_change",
        resourceType: "deal",
        resourceId: current.id,
        ...(current.status === merged.status
          ? {}
          : { metadata: { previousStatus: current.status, status: merged.status } }),
      }),
    );
    const deal = await getDeal(database, workspace.workspaceId, current.id);
    return context.json({ data: serializeDeal(deal!) });
  });

  api.post("/deals/:id/move", requireRole("marketer"), async (context) => {
    const parsed = dealMoveSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const database = context.get("database");
    const workspace = context.get("workspace");
    const deal = await getDeal(database, workspace.workspaceId, context.req.param("id"));
    if (!deal) return apiError(context, 404, "deal_not_found", "商談が見つかりません");
    const stage = await database
      .prepare(
        `SELECT id FROM deal_stages
         WHERE workspace_id = ? AND pipeline_id = ? AND id = ?`,
      )
      .bind(workspace.workspaceId, deal.pipeline_id, parsed.data.stageId)
      .first();
    if (!stage) {
      return apiError(
        context,
        422,
        "invalid_deal_stage",
        "移動先ステージがパイプラインに存在しません",
      );
    }
    await database
      .prepare(
        `UPDATE deals SET stage_id = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(parsed.data.stageId, new Date().toISOString(), workspace.workspaceId, deal.id)
      .run();
    context.executionCtx.waitUntil(
      writeAuditLog(database, workspace, {
        action: "deal.move",
        resourceType: "deal",
        resourceId: deal.id,
        metadata: { previousStageId: deal.stage_id, stageId: parsed.data.stageId },
      }),
    );
    const updated = await getDeal(database, workspace.workspaceId, deal.id);
    return context.json({ data: serializeDeal(updated!) });
  });

  api.post("/deals/:id/archive", requireRole("marketer"), async (context) => {
    const database = context.get("database");
    const workspace = context.get("workspace");
    const id = context.req.param("id");
    const now = new Date().toISOString();
    const result = await database
      .prepare(
        `UPDATE deals SET archived_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(now, now, workspace.workspaceId, id)
      .run();
    if (result.meta.changes === 0) {
      return apiError(context, 404, "deal_not_found", "商談が見つかりません");
    }
    context.executionCtx.waitUntil(
      writeAuditLog(database, workspace, {
        action: "deal.archive",
        resourceType: "deal",
        resourceId: id,
      }),
    );
    return context.json({ data: { archived: true } });
  });

  api.post("/deals/:id/tasks", requireRole("marketer"), async (context) => {
    const parsed = dealTaskCreateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    const dealId = context.req.param("id");
    if (!(await dealExists(database, workspaceId, dealId))) {
      return apiError(context, 404, "deal_not_found", "商談が見つかりません");
    }
    if (
      parsed.data.assignedUserId &&
      !(await memberExists(database, workspaceId, parsed.data.assignedUserId))
    ) {
      return apiError(context, 422, "invalid_deal_task_assignee", "担当者が見つかりません");
    }
    const id = uuidv7();
    const now = new Date().toISOString();
    await database
      .prepare(
        `INSERT INTO deal_tasks (
           id, workspace_id, deal_id, type, title, notes, due_at, status,
           assigned_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .bind(
        id,
        workspaceId,
        dealId,
        parsed.data.type,
        parsed.data.title,
        parsed.data.notes,
        parsed.data.dueAt ?? null,
        parsed.data.assignedUserId ?? null,
        now,
        now,
      )
      .run();
    const task = await getTask(database, workspaceId, dealId, id);
    return context.json({ data: serializeTask(task!) }, 201);
  });

  api.patch("/deals/:dealId/tasks/:taskId", requireRole("marketer"), async (context) => {
    const parsed = dealTaskUpdateSchema.safeParse(await safeJson(context));
    if (!parsed.success) return validationError(context, parsed.error);
    const database = context.get("database");
    const workspaceId = context.get("workspace").workspaceId;
    const dealId = context.req.param("dealId");
    const taskId = context.req.param("taskId");
    const current = await getTask(database, workspaceId, dealId, taskId);
    if (!current) return apiError(context, 404, "deal_task_not_found", "タスクが見つかりません");
    const assignedUserId =
      parsed.data.assignedUserId === undefined
        ? current.assigned_user_id
        : parsed.data.assignedUserId;
    if (assignedUserId && !(await memberExists(database, workspaceId, assignedUserId))) {
      return apiError(context, 422, "invalid_deal_task_assignee", "担当者が見つかりません");
    }
    const status = parsed.data.status ?? current.status;
    const now = new Date().toISOString();
    const completedAt =
      status === "completed" ? (current.status === "completed" ? current.completed_at : now) : null;
    await database
      .prepare(
        `UPDATE deal_tasks SET
           type = ?, title = ?, notes = ?, due_at = ?, status = ?,
           assigned_user_id = ?, completed_at = ?, updated_at = ?
         WHERE workspace_id = ? AND deal_id = ? AND id = ?`,
      )
      .bind(
        parsed.data.type ?? current.type,
        parsed.data.title ?? current.title,
        parsed.data.notes ?? current.notes,
        parsed.data.dueAt === undefined ? current.due_at : parsed.data.dueAt,
        status,
        assignedUserId,
        completedAt,
        now,
        workspaceId,
        dealId,
        taskId,
      )
      .run();
    const task = await getTask(database, workspaceId, dealId, taskId);
    return context.json({ data: serializeTask(task!) });
  });

  api.delete("/deals/:dealId/tasks/:taskId", requireRole("marketer"), async (context) => {
    const result = await context
      .get("database")
      .prepare(
        `DELETE FROM deal_tasks
         WHERE workspace_id = ? AND deal_id = ? AND id = ?`,
      )
      .bind(
        context.get("workspace").workspaceId,
        context.req.param("dealId"),
        context.req.param("taskId"),
      )
      .run();
    return result.meta.changes > 0
      ? context.json({ data: { removed: true } })
      : apiError(context, 404, "deal_task_not_found", "タスクが見つかりません");
  });
}

const dealSelectSql = `
  SELECT
    d.*,
    dp.name AS pipeline_name,
    ds.name AS stage_name,
    ds.color AS stage_color,
    ds.position AS stage_position,
    ds.probability AS stage_probability,
    u.name AS owner_name,
    u.email AS owner_email,
    c.email AS contact_email,
    c.first_name AS contact_first_name,
    c.last_name AS contact_last_name,
    co.name AS account_name,
    (
      SELECT COUNT(*)
      FROM deal_tasks dt
      WHERE dt.workspace_id = d.workspace_id
        AND dt.deal_id = d.id
        AND dt.status = 'open'
    ) AS open_task_count,
    (
      SELECT MIN(dt.due_at)
      FROM deal_tasks dt
      WHERE dt.workspace_id = d.workspace_id
        AND dt.deal_id = d.id
        AND dt.status = 'open'
    ) AS next_task_at
  FROM deals d
  JOIN deal_pipelines dp
    ON dp.workspace_id = d.workspace_id AND dp.id = d.pipeline_id
  JOIN deal_stages ds
    ON ds.workspace_id = d.workspace_id AND ds.id = d.stage_id
  LEFT JOIN user u ON u.id = d.owner_user_id
  LEFT JOIN contacts c
    ON c.workspace_id = d.workspace_id AND c.id = d.contact_id
  LEFT JOIN companies co
    ON co.workspace_id = d.workspace_id AND co.id = d.account_id`;

async function ensureDefaultPipeline(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<string> {
  const existing = await database
    .prepare(
      `SELECT id FROM deal_pipelines
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const pipelineId = uuidv7();
  const now = new Date().toISOString();
  const statements: DrizzleRawStatement[] = [
    database
      .prepare(
        `INSERT INTO deal_pipelines
         (id, workspace_id, name, is_default, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(pipelineId, workspaceId, "セールスパイプライン", now, now),
    ...defaultStages.map((stage, position) =>
      database
        .prepare(
          `INSERT INTO deal_stages
           (id, workspace_id, pipeline_id, name, color, position, probability, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uuidv7(),
          workspaceId,
          pipelineId,
          stage.name,
          stage.color,
          position,
          stage.probability,
          now,
          now,
        ),
    ),
  ];
  try {
    await database.batch(statements);
    return pipelineId;
  } catch {
    const raced = await database
      .prepare(
        `SELECT id FROM deal_pipelines
         WHERE workspace_id = ? AND archived_at IS NULL
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
      )
      .bind(workspaceId)
      .first<{ id: string }>();
    if (raced) return raced.id;
    throw new Error("デフォルトの商談パイプラインを作成できませんでした");
  }
}

async function validateDealReferences(
  database: KaenmaDatabase,
  workspaceId: string,
  input: DealCreate,
): Promise<string | null> {
  const stage = await database
    .prepare(
      `SELECT ds.id
       FROM deal_stages ds
       JOIN deal_pipelines dp
         ON dp.workspace_id = ds.workspace_id AND dp.id = ds.pipeline_id
       WHERE ds.workspace_id = ? AND ds.pipeline_id = ? AND ds.id = ?
         AND dp.archived_at IS NULL`,
    )
    .bind(workspaceId, input.pipelineId, input.stageId)
    .first();
  if (!stage) return "パイプラインまたはステージが見つかりません";
  if (
    input.contactId &&
    !(await database
      .prepare(
        `SELECT id FROM contacts
         WHERE workspace_id = ? AND id = ? AND status != 'archived'`,
      )
      .bind(workspaceId, input.contactId)
      .first())
  ) {
    return "連絡先が見つかりません";
  }
  if (
    input.accountId &&
    !(await database
      .prepare("SELECT id FROM companies WHERE workspace_id = ? AND id = ?")
      .bind(workspaceId, input.accountId)
      .first())
  ) {
    return "アカウントが見つかりません";
  }
  if (input.ownerUserId && !(await memberExists(database, workspaceId, input.ownerUserId))) {
    return "担当者が見つかりません";
  }
  return null;
}

async function pipelineExists(
  database: KaenmaDatabase,
  workspaceId: string,
  pipelineId: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare(
        `SELECT id FROM deal_pipelines
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(workspaceId, pipelineId)
      .first(),
  );
}

async function dealExists(
  database: KaenmaDatabase,
  workspaceId: string,
  dealId: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare(
        `SELECT id FROM deals
         WHERE workspace_id = ? AND id = ? AND archived_at IS NULL`,
      )
      .bind(workspaceId, dealId)
      .first(),
  );
}

async function memberExists(
  database: KaenmaDatabase,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare("SELECT id FROM member WHERE organization_id = ? AND user_id = ?")
      .bind(workspaceId, userId)
      .first(),
  );
}

async function getDeal(
  database: KaenmaDatabase,
  workspaceId: string,
  id: string,
): Promise<DealRow | null> {
  return database
    .prepare(`${dealSelectSql} WHERE d.workspace_id = ? AND d.id = ? AND d.archived_at IS NULL`)
    .bind(workspaceId, id)
    .first<DealRow>();
}

async function getTask(
  database: KaenmaDatabase,
  workspaceId: string,
  dealId: string,
  taskId: string,
): Promise<TaskRow | null> {
  return database
    .prepare(
      `SELECT dt.*, u.name AS assignee_name, u.email AS assignee_email
       FROM deal_tasks dt
       LEFT JOIN user u ON u.id = dt.assigned_user_id
       WHERE dt.workspace_id = ? AND dt.deal_id = ? AND dt.id = ?`,
    )
    .bind(workspaceId, dealId, taskId)
    .first<TaskRow>();
}

function serializeStage(stage: StageRow) {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    position: Number(stage.position),
    probability: Number(stage.probability),
  };
}

function serializeDeal(row: DealRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageColor: row.stage_color,
    stagePosition: Number(row.stage_position),
    stageProbability: Number(row.stage_probability),
    name: row.name,
    value: Number(row.value),
    currency: row.currency,
    status: row.status,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    contactId: row.contact_id,
    contactEmail: row.contact_email,
    contactFirstName: row.contact_first_name,
    contactLastName: row.contact_last_name,
    accountId: row.account_id,
    accountName: row.account_name,
    expectedCloseDate: row.expected_close_date,
    description: row.description,
    wonAt: row.won_at,
    lostAt: row.lost_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openTaskCount: Number(row.open_task_count),
    nextTaskAt: row.next_task_at,
  };
}

function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    dealId: row.deal_id,
    type: row.type,
    title: row.title,
    notes: row.notes,
    dueAt: row.due_at,
    status: row.status,
    assignedUserId: row.assigned_user_id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

import { uuidv7, type DrizzleRawStatement, type KaenmaDatabase } from "@kaenma/database";
import type { DealCreate } from "@kaenma/orpc";

const defaultStages = [
  { name: "新規", color: "#64748b", probability: 10 },
  { name: "連絡済み", color: "#3b82f6", probability: 25 },
  { name: "提案", color: "#8b5cf6", probability: 50 },
  { name: "交渉", color: "#f59e0b", probability: 75 },
  { name: "最終確認", color: "#10b981", probability: 90 },
] as const;

export async function ensureDefaultPipeline(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<string> {
  const existing = await findDefaultPipeline(database, workspaceId);
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
    const raced = await findDefaultPipeline(database, workspaceId);
    if (raced) return raced.id;
    throw new Error("デフォルトの商談パイプラインを作成できませんでした");
  }
}

export async function validateDealReferences(
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

export async function pipelineExists(
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

export async function dealExists(
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

export async function memberExists(
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

function findDefaultPipeline(
  database: KaenmaDatabase,
  workspaceId: string,
): Promise<{ id: string } | null> {
  return database
    .prepare(
      `SELECT id FROM deal_pipelines
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ id: string }>();
}

import { uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { DataJob } from "@kaenma/orpc";
import type { WorkspaceContext } from "@kaenma/orpc";

import { nullablePrimitiveString, numericValue, primitiveString } from "../platform/values";
import { parseCsv } from "./csv";

interface ImportDeps {
  bucket: R2Bucket;
  queue: Queue;
}

export type ContactImportOutcome =
  | { kind: "identifier_missing" }
  | { kind: "started"; jobId: string; rows: number; parts: number };

export async function startContactImport(
  database: KaenmaDatabase,
  deps: ImportDeps,
  workspace: WorkspaceContext,
  csvText: string,
): Promise<ContactImportOutcome> {
  const rows = parseCsv(csvText);
  const header = rows.shift()?.map((value) => value.trim().toLowerCase());
  if (!header?.includes("email") && !header?.includes("external_id")) {
    return { kind: "identifier_missing" };
  }
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
        return deps.bucket.put(`${baseKey}/part-${index}.ndjson`, part, {
          httpMetadata: { contentType: "application/x-ndjson" },
        });
      }),
    );
  }
  await deps.bucket.put(
    `${baseKey}/manifest.json`,
    JSON.stringify({ header, parts: parts.length, rows: rows.length }),
    { httpMetadata: { contentType: "application/json" } },
  );
  const now = new Date().toISOString();
  await database
    .prepare(
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
    await deps.queue.send({
      kind: "contact_import",
      importJobId: jobId,
      part: 0,
      totalParts: parts.length,
    });
  } else {
    await database
      .prepare("UPDATE import_jobs SET status = 'completed', updated_at = ? WHERE id = ?")
      .bind(now, jobId)
      .run();
  }
  return { kind: "started", jobId, rows: rows.length, parts: parts.length };
}

export async function startContactExport(
  database: KaenmaDatabase,
  queue: Queue,
  workspace: WorkspaceContext,
): Promise<{ jobId: string }> {
  const jobId = uuidv7();
  const key = `${workspace.workspaceId}/exports/contacts-${jobId}.csv`;
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO import_jobs
       (id, workspace_id, kind, r2_key, status, cursor, created_at, updated_at)
       VALUES (?, ?, 'contact_export', ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      jobId,
      workspace.workspaceId,
      key,
      JSON.stringify({ partNumber: 0, lastId: "" }),
      now,
      now,
    )
    .run();
  await queue.send({ kind: "contact_export", exportJobId: jobId });
  return { jobId };
}

export async function getDataJob(
  database: KaenmaDatabase,
  workspaceId: string,
  jobId: string,
): Promise<DataJob | null> {
  const row = await database
    .prepare(
      `SELECT id, kind, status, processed, succeeded, failed,
              error_manifest_key, created_at, updated_at
       FROM import_jobs WHERE workspace_id = ? AND id = ?`,
    )
    .bind(workspaceId, jobId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: primitiveString(row["id"]),
    kind: primitiveString(row["kind"]) as DataJob["kind"],
    status: primitiveString(row["status"]),
    processed: numericValue(row["processed"]),
    succeeded: numericValue(row["succeeded"]),
    failed: numericValue(row["failed"]),
    errorManifestKey: nullablePrimitiveString(row["error_manifest_key"]),
    createdAt: primitiveString(row["created_at"]),
    updatedAt: primitiveString(row["updated_at"]),
  };
}

export type ExportDownloadOutcome =
  | { kind: "not_ready" }
  | { kind: "missing" }
  | { kind: "ready"; file: File };

export async function getContactExportFile(
  database: KaenmaDatabase,
  bucket: R2Bucket,
  workspaceId: string,
  jobId: string,
): Promise<ExportDownloadOutcome> {
  const row = await database
    .prepare(
      `SELECT r2_key, status FROM import_jobs
       WHERE workspace_id = ? AND id = ? AND kind = 'contact_export'`,
    )
    .bind(workspaceId, jobId)
    .first<{ r2_key: string; status: string }>();
  if (!row || row.status !== "completed") return { kind: "not_ready" };
  const object = await bucket.get(row.r2_key);
  if (!object) return { kind: "missing" };
  const bytes = await object.arrayBuffer();
  return {
    kind: "ready",
    file: new File([bytes], `kaenma-contacts-${jobId}.csv`, { type: "text/csv" }),
  };
}

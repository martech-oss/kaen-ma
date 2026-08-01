import { PermanentChannelError } from "@kaenma/channels";
import { createDatabase, uuidv7, type DrizzleRawStatement } from "@kaenma/database";

import { type RuntimeEnv } from "../env";
import { parseJsonRecord, stringValue } from "../platform/values";
import { primitiveString } from "../platform/values";

export async function processContactImport(
  jobId: string,
  part: number,
  totalParts: number,
  env: RuntimeEnv,
): Promise<void> {
  const job = await createDatabase(env.DB)
    .prepare(
      `SELECT workspace_id, r2_key, status FROM import_jobs
     WHERE id = ? AND kind = 'contact_import' AND status IN ('pending', 'processing')`,
    )
    .bind(jobId)
    .first<{ workspace_id: string; r2_key: string; status: string }>();
  if (!job) return;
  await createDatabase(env.DB)
    .prepare("UPDATE import_jobs SET status = 'processing', updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), jobId)
    .run();
  const object = await env.ASSETS_BUCKET.get(`${job.r2_key}/part-${part}.ndjson`);
  if (!object) throw new PermanentChannelError(`Import part ${part} is missing`);
  const lines = (await object.text()).split("\n").filter(Boolean);
  let succeeded = 0;
  let failed = 0;
  const statements: DrizzleRawStatement[] = [];
  const now = new Date().toISOString();
  for (const line of lines) {
    try {
      const source = parseJsonRecord(line);
      const email =
        typeof source["email"] === "string" && source["email"].trim()
          ? source["email"].trim().toLowerCase()
          : null;
      const externalId =
        typeof source["external_id"] === "string" && source["external_id"].trim()
          ? source["external_id"].trim()
          : null;
      if (!email && !externalId) {
        failed += 1;
        continue;
      }
      const customFields = { ...source };
      for (const key of ["email", "external_id", "first_name", "last_name", "phone", "stage"]) {
        delete customFields[key];
      }
      statements.push(
        createDatabase(env.DB)
          .prepare(
            `INSERT OR IGNORE INTO contacts
           (id, workspace_id, email, first_name, last_name, phone, external_id,
            stage, score, status, custom_fields, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
          )
          .bind(
            uuidv7(),
            job.workspace_id,
            email,
            stringValue(source["first_name"]),
            stringValue(source["last_name"]),
            stringValue(source["phone"]),
            externalId,
            stringValue(source["stage"]) ?? "lead",
            JSON.stringify(customFields),
            now,
            now,
          ),
      );
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  if (statements.length > 0) await createDatabase(env.DB).batch(statements);
  const finished = part + 1 >= totalParts;
  await createDatabase(env.DB)
    .prepare(
      `UPDATE import_jobs SET status = ?, cursor = ?, processed = processed + ?,
     succeeded = succeeded + ?, failed = failed + ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      finished ? "completed" : "processing",
      JSON.stringify({ part: part + 1, totalParts }),
      lines.length,
      succeeded,
      failed,
      new Date().toISOString(),
      jobId,
    )
    .run();
  if (!finished) {
    await env.CAMPAIGN_QUEUE.send({
      kind: "contact_import",
      importJobId: jobId,
      part: part + 1,
      totalParts,
    });
  }
}

export async function processContactExport(jobId: string, env: RuntimeEnv): Promise<void> {
  const job = await createDatabase(env.DB)
    .prepare(
      `SELECT workspace_id, r2_key, status, cursor FROM import_jobs
     WHERE id = ? AND kind = 'contact_export' AND status IN ('pending', 'processing')`,
    )
    .bind(jobId)
    .first<{
      workspace_id: string;
      r2_key: string;
      status: string;
      cursor: string;
    }>();
  if (!job) return;
  const cursor = parseJsonRecord(job.cursor);
  const lastId = typeof cursor["lastId"] === "string" ? cursor["lastId"] : "";
  const partNumber = typeof cursor["partNumber"] === "number" ? cursor["partNumber"] : 0;
  const batchSize = 1_000;
  const contacts = await createDatabase(env.DB)
    .prepare(
      `SELECT id, email, first_name, last_name, phone, external_id, stage, score,
            status, custom_fields, created_at, updated_at
     FROM contacts WHERE workspace_id = ? AND id > ?
     ORDER BY id ASC LIMIT ?`,
    )
    .bind(job.workspace_id, lastId, batchSize)
    .all<Record<string, unknown>>();
  if (contacts.results.length > 0) {
    const header =
      partNumber === 0
        ? "id,email,first_name,last_name,phone,external_id,stage,score,status,custom_fields,created_at,updated_at\n"
        : "";
    const body =
      header +
      contacts.results
        .map((contact) =>
          [
            contact["id"],
            contact["email"],
            contact["first_name"],
            contact["last_name"],
            contact["phone"],
            contact["external_id"],
            contact["stage"],
            contact["score"],
            contact["status"],
            contact["custom_fields"],
            contact["created_at"],
            contact["updated_at"],
          ]
            .map(csvCell)
            .join(","),
        )
        .join("\n") +
      "\n";
    await env.ASSETS_BUCKET.put(`${job.r2_key}.parts/${partNumber}.csv`, body, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
    });
    const last = contacts.results.at(-1);
    await createDatabase(env.DB)
      .prepare(
        `UPDATE import_jobs SET status = 'processing', cursor = ?,
       processed = processed + ?, succeeded = succeeded + ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        JSON.stringify({
          partNumber: partNumber + 1,
          lastId: primitiveString(last?.["id"], lastId),
        }),
        contacts.results.length,
        contacts.results.length,
        new Date().toISOString(),
        jobId,
      )
      .run();
  }
  if (contacts.results.length === batchSize) {
    await env.CAMPAIGN_QUEUE.send({ kind: "contact_export", exportJobId: jobId });
    return;
  }
  const chunks: ArrayBuffer[] = [];
  for (let index = 0; index < partNumber + (contacts.results.length > 0 ? 1 : 0); index += 1) {
    const part = await env.ASSETS_BUCKET.get(`${job.r2_key}.parts/${index}.csv`);
    if (!part) throw new PermanentChannelError(`Export part ${index} is missing`);
    chunks.push(await part.arrayBuffer());
  }
  await env.ASSETS_BUCKET.put(job.r2_key, new Blob(chunks), {
    httpMetadata: {
      contentType: "text/csv; charset=utf-8",
      contentDisposition: `attachment; filename="kaenma-contacts-${jobId}.csv"`,
    },
  });
  const now = new Date().toISOString();
  await createDatabase(env.DB)
    .prepare("UPDATE import_jobs SET status = 'completed', updated_at = ? WHERE id = ?")
    .bind(now, jobId)
    .run();
}

export function csvCell(value: unknown): string {
  let rendered =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}

import { and, eq } from "drizzle-orm";

import { assets, uuidv7, type KaenmaDatabase } from "@kaenma/database";
import type { AssetSummary } from "@kaenma/orpc";

import { sanitizeFilename, sha256HexFromBytes } from "../http/helpers";

export async function uploadAsset(
  database: KaenmaDatabase,
  bucket: R2Bucket,
  workspaceId: string,
  input: { name: string; body: ArrayBuffer; contentType: string },
): Promise<AssetSummary> {
  const id = uuidv7();
  const key = `${workspaceId}/assets/${id}/${sanitizeFilename(input.name)}`;
  const checksum = await sha256HexFromBytes(input.body);
  await bucket.put(key, input.body, {
    httpMetadata: { contentType: input.contentType },
    customMetadata: { workspaceId, assetId: id },
    sha256: checksum,
  });
  const now = new Date().toISOString();
  await database.orm.insert(assets).values({
    id,
    workspaceId,
    name: input.name,
    r2Key: key,
    contentType: input.contentType,
    size: input.body.byteLength,
    checksum,
    createdAt: now,
    updatedAt: now,
  });
  return { id, name: input.name, contentType: input.contentType, size: input.body.byteLength };
}

export async function getAssetFile(
  database: KaenmaDatabase,
  bucket: R2Bucket,
  workspaceId: string,
  assetId: string,
): Promise<File | null> {
  const row = await database.orm.query.assets.findFirst({
    columns: { r2Key: true, contentType: true, name: true },
    where: and(eq(assets.workspaceId, workspaceId), eq(assets.id, assetId)),
  });
  if (!row) return null;
  const object = await bucket.get(row.r2Key);
  if (!object) return null;
  const bytes = await object.arrayBuffer();
  return new File([bytes], sanitizeFilename(row.name), { type: row.contentType });
}

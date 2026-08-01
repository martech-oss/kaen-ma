import { authed, requireRole } from "../orpc/base";
import { getAssetFile, uploadAsset } from "./asset-service";

export const uploadAssetProcedure = authed.assets.upload.handler(
  async ({ context, input, errors }) => {
    requireRole(context.workspace.role, "marketer", errors.FORBIDDEN);
    const body = await input.file.arrayBuffer();
    return uploadAsset(context.database, context.env.ASSETS_BUCKET, context.workspace.workspaceId, {
      name: input.name,
      body,
      contentType: input.file.type || "application/octet-stream",
    });
  },
);

export const downloadAssetProcedure = authed.assets.download.handler(
  async ({ context, input, errors }) => {
    const file = await getAssetFile(
      context.database,
      context.env.ASSETS_BUCKET,
      context.workspace.workspaceId,
      input.id,
    );
    if (!file) throw errors.ASSET_NOT_FOUND();
    return file;
  },
);

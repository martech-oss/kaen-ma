import { oc } from "@orpc/contract";
import * as z from "zod";

import { authedErrors, workspaceErrors } from "../shared/errors";
import { assetVisibilitySchema } from "../shared/schema";
import { assetListResultSchema, assetSchema } from "./dto";
import {
  ASSET_BUFFERED_MAX_BYTES,
  assetIdInputSchema,
  assetListInputSchema,
  assetUpdateInputSchema,
} from "./schema";

const notFound = {
  ASSET_NOT_FOUND: { status: 404, message: "アセットが見つかりません" },
} as const;

/**
 * Size is enforced by `z.file().max()` on the input, which surfaces as a plain
 * input-validation error - the streaming route returns 413 itself, so no
 * ASSET_TOO_LARGE code is declared here that could never fire.
 */
const uploadErrors = {
  ASSET_CONTENT_TYPE_BLOCKED: {
    status: 415,
    message: "このファイル形式はアップロードできません",
  },
} as const;

export const assetsContract = {
  list: oc
    .route({ method: "GET", path: "/assets" })
    .errors(workspaceErrors)
    .input(assetListInputSchema)
    .output(assetListResultSchema),
  get: oc
    .route({ method: "GET", path: "/assets/{id}" })
    .errors({ ...workspaceErrors, ...notFound })
    .input(assetIdInputSchema)
    .output(assetSchema),
  upload: oc
    .route({ method: "POST", path: "/assets", successStatus: 201 })
    .errors({ ...authedErrors, ...uploadErrors })
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        file: z.file().max(ASSET_BUFFERED_MAX_BYTES),
        visibility: assetVisibilitySchema.default("private"),
      }),
    )
    .output(assetSchema),
  /**
   * Sits at `/file` rather than `/assets/{id}` because `get` needs that path -
   * two procedures on one method+path make the OpenAPI handler match only the
   * first and emit a duplicate path in the document.
   */
  download: oc
    .route({ method: "GET", path: "/assets/{id}/file" })
    .errors({ ...workspaceErrors, ...notFound })
    .input(assetIdInputSchema)
    .output(z.file()),
  update: oc
    .route({ method: "PATCH", path: "/assets/{id}" })
    .errors({
      ...authedErrors,
      ...notFound,
      ASSET_ARCHIVED: { status: 409, message: "アーカイブ済みのアセットは編集できません" },
    })
    .input(assetUpdateInputSchema)
    .output(assetSchema),
  archive: oc
    .route({ method: "POST", path: "/assets/{id}/archive" })
    .errors({ ...authedErrors, ...notFound })
    .input(assetIdInputSchema)
    .output(z.object({ archived: z.literal(true) })),
  restore: oc
    .route({ method: "POST", path: "/assets/{id}/restore" })
    .errors({
      ...authedErrors,
      ASSET_NOT_ARCHIVED: { status: 404, message: "復元できるアセットが見つかりません" },
    })
    .input(assetIdInputSchema)
    .output(z.object({ restored: z.literal(true) })),
  delete: oc
    .route({ method: "DELETE", path: "/assets/{id}" })
    .errors({ ...authedErrors, ...notFound })
    .input(assetIdInputSchema)
    .output(z.object({ deleted: z.literal(true) })),
};

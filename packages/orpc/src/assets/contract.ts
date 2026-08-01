import { oc } from "@orpc/contract";
import * as z from "zod";

import { authedErrors, workspaceErrors } from "../shared/errors";

export const ASSET_MAX_BYTES = 25 * 1024 * 1024;

export const assetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
});
export type AssetSummary = z.infer<typeof assetSummarySchema>;

export const assetsContract = {
  upload: oc
    .route({ method: "POST", path: "/assets", successStatus: 201 })
    .errors(authedErrors)
    .input(
      z.object({
        name: z.string().trim().min(1).max(191),
        file: z.file().max(ASSET_MAX_BYTES),
      }),
    )
    .output(assetSummarySchema),
  download: oc
    .route({ method: "GET", path: "/assets/{id}" })
    .errors({
      ...workspaceErrors,
      ASSET_NOT_FOUND: { status: 404, message: "Assetが見つかりません" },
    })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.file()),
};

import * as z from "zod";

import {
  assetChecksumAlgorithmSchema,
  assetKindSchema,
  assetVisibilitySchema,
} from "../shared/schema";

export const assetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  originalFilename: z.string(),
  kind: assetKindSchema,
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  visibility: assetVisibilitySchema,
  /**
   * Absolute and cache-busted with `?v=<checksum prefix>`. Null while the asset
   * is private or archived, because the public route would 404 either way.
   */
  publicUrl: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetSummary = z.infer<typeof assetSummarySchema>;

export const assetSchema = assetSummarySchema.extend({
  description: z.string(),
  altText: z.string(),
  checksum: z.string(),
  checksumAlgorithm: assetChecksumAlgorithmSchema,
  createdByUserId: z.string().nullable(),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetListResultSchema = z.object({
  items: z.array(assetSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});
export type AssetListResult = z.infer<typeof assetListResultSchema>;

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppDialog } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { type AssetSummary, formatBytes } from "@/features/assets/asset-api";
import { AssetThumbnail } from "@/features/assets/asset-bits";
import { orpcQuery } from "@/lib/orpc";

/**
 * Picks a *public* image to embed. Private assets are excluded on purpose:
 * their `publicUrl` is null, and the content document's `image.src` is a
 * `z.url()` that would reject an empty string anyway.
 */
export function AssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: AssetSummary) => void;
}): ReactNode {
  const assetsQuery = useQuery({
    ...orpcQuery.assets.list.queryOptions({
      input: { kind: "image", visibility: "public", status: "active", limit: 60 },
    }),
    enabled: open,
  });
  const items = (assetsQuery.data?.items ?? []).filter((asset) => asset.publicUrl !== null);

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="アセットから画像を選択"
      description="公開設定になっている画像のみ埋め込めます。"
      className="sm:max-w-2xl"
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">公開されている画像がありません。</p>
          <Button variant="outline" render={<Link to="/website/assets" />} nativeButton={false}>
            アセットライブラリを開く
          </Button>
        </div>
      ) : (
        <ul className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-3">
          {items.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                className="flex w-full flex-col overflow-hidden rounded-lg border text-left transition-colors hover:border-primary"
                onClick={() => onSelect(asset)}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted">
                  <AssetThumbnail asset={asset} />
                </div>
                <span className="truncate px-2 pt-2 text-sm font-medium">{asset.name}</span>
                <span className="px-2 pb-2 text-xs text-muted-foreground">
                  {formatBytes(asset.size)}
                  {asset.width && asset.height ? ` ・ ${asset.width}×${asset.height}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppDialog>
  );
}

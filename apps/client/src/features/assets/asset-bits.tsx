import { File as FileIcon, FileText, Music, Video } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  ASSET_KIND_LABELS,
  ASSET_VISIBILITY_LABELS,
  assetDisplayUrl,
  type AssetKind,
  type AssetSummary,
  type AssetVisibility,
} from "@/features/assets/asset-api";
import { cn } from "@/lib/utils";

const kindIcons: Record<Exclude<AssetKind, "image">, typeof FileIcon> = {
  document: FileText,
  video: Video,
  audio: Music,
  other: FileIcon,
};

export function AssetKindBadge({ kind }: { kind: AssetKind }): ReactNode {
  return <Badge variant="secondary">{ASSET_KIND_LABELS[kind]}</Badge>;
}

export function AssetVisibilityBadge({
  visibility,
  archived,
}: {
  visibility: AssetVisibility;
  archived: boolean;
}): ReactNode {
  if (archived) return <Badge variant="outline">アーカイブ済み</Badge>;
  return (
    <Badge variant={visibility === "public" ? "default" : "secondary"}>
      {ASSET_VISIBILITY_LABELS[visibility]}
    </Badge>
  );
}

/**
 * Renders the real bytes for images and an icon tile for everything else.
 * The `<img>` is same-origin so the browser sends the session cookie, which is
 * what lets private assets preview through `/api/assets/:id/raw` unchanged.
 */
export function AssetThumbnail({
  asset,
  className,
}: {
  asset: AssetSummary;
  className?: string;
}): ReactNode {
  if (asset.kind === "image") {
    return (
      <img
        src={assetDisplayUrl(asset)}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("size-full bg-muted object-contain", className)}
      />
    );
  }
  const Icon = kindIcons[asset.kind];
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-8" aria-hidden />
    </div>
  );
}

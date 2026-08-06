import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { PublishStatus } from "@/features/website/website-api";
import { RESOURCE_STATUS_LABELS } from "@/lib/status-labels";

export function PublishStatusBadge({ status }: { status: PublishStatus }): ReactNode {
  return (
    <Badge variant={status === "published" ? "default" : "secondary"}>
      {RESOURCE_STATUS_LABELS[status]}
    </Badge>
  );
}

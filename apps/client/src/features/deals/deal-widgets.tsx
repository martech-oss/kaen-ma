import { type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { type DealStatus } from "@/features/deals/deal-api";

export function DetailItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}): ReactNode {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
      {detail && detail !== value ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

export function DealStatusBadge({ status }: { status: DealStatus }): ReactNode {
  if (status === "won") return <Badge>獲得</Badge>;
  if (status === "lost") return <Badge variant="destructive">失注</Badge>;
  return <Badge variant="secondary">進行中</Badge>;
}

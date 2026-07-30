import { type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type DealStatus } from "@/features/deals/deal-api";

export function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="truncate text-xl">{value}</CardTitle>
        <CardAction>
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

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

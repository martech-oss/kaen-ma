import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricGrid({
  children,
  className = "sm:grid-cols-2 xl:grid-cols-4",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={cn("grid gap-4", className)}>{children}</div>;
}

export function MetricCard({
  label,
  value,
  icon,
  description,
  children,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="truncate text-2xl tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </CardTitle>
        {icon ? (
          <CardAction>
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4">
              {icon}
            </span>
          </CardAction>
        ) : null}
      </CardHeader>
      {description || children ? (
        <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
          {description}
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}

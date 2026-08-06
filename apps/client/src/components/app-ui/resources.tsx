import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ResourceGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

export function ResourceCard({
  icon,
  title,
  subtitle,
  footer,
  action,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  footer: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{title}</CardTitle>
            <CardDescription>{subtitle}</CardDescription>
          </div>
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardFooter className="text-xs text-muted-foreground">{footer}</CardFooter>
    </Card>
  );
}

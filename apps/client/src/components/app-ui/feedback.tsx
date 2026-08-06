import { BlocksIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

export function EmptyState({
  title,
  description,
  compact = false,
  action,
}: {
  title: string;
  description?: string;
  compact?: boolean;
  action?: ReactNode;
}): ReactNode {
  return (
    <Empty className={compact ? "py-8" : "min-h-56 border"}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BlocksIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action}
    </Empty>
  );
}

export function SimpleEmpty({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}): ReactNode {
  return <EmptyState title={label} compact={compact} />;
}

export function PageLoading({ label = "読み込み中…" }: { label?: string }): ReactNode {
  return (
    <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorAlert({ children }: { children: ReactNode }): ReactNode {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>エラー</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function SuccessAlert({ children }: { children: ReactNode }): ReactNode {
  return (
    <Alert>
      <CircleCheckIcon />
      <AlertTitle>完了</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function LoadingButton({
  busy,
  busyLabel,
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & {
  busy: boolean;
  busyLabel?: string;
}): ReactNode {
  return (
    <Button disabled={busy || disabled} {...props}>
      {busy ? <Spinner data-icon="inline-start" /> : null}
      {busy ? (busyLabel ?? "処理中…") : children}
    </Button>
  );
}

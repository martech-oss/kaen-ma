import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BlocksIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">
        {title}
      </h1>
      {action}
    </header>
  );
}

export function PageLayout({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} action={action} />
      {children}
    </div>
  );
}

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className ?? "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function FormInput({
  label,
  description,
  error,
  id,
  name,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  description?: string;
  error?: string;
  id?: string;
  name: string;
}): ReactNode {
  const inputId = id ?? name;
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        name={name}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function FormTextarea({
  label,
  description,
  error,
  id,
  name,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "id"> & {
  label: string;
  description?: string;
  error?: string;
  id?: string;
  name: string;
}): ReactNode {
  const inputId = id ?? name;
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Textarea
        id={inputId}
        name={name}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export function FormNativeSelect({
  label,
  description,
  error,
  id,
  name,
  disabled,
  children,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, "id"> & {
  label: string;
  description?: string;
  error?: string;
  id?: string;
  name: string;
  children: ReactNode;
}): ReactNode {
  const inputId = id ?? name;
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <NativeSelect
        id={inputId}
        name={name}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        className="w-full"
        {...props}
      >
        {children}
      </NativeSelect>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export { NativeSelectOption as FormSelectOption };

export function ResourceGrid({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
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
      <CardFooter className="text-xs text-muted-foreground">
        {footer}
      </CardFooter>
    </Card>
  );
}

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
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
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

export function PageLoading({
  label = "読み込み中…",
}: {
  label?: string;
}): ReactNode {
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

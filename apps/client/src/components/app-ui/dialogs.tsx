import { ArchiveIcon } from "lucide-react";
import type { FormEvent, ReactElement, ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ErrorAlert, LoadingButton } from "./feedback";

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
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  busy,
  error,
  submitLabel,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error?: string;
  submitLabel: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description !== undefined ? { description } : {})}
      {...(className !== undefined ? { className } : {})}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {children}
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} className="w-full" type="submit">
          {submitLabel}
        </LoadingButton>
      </form>
    </AppDialog>
  );
}

export function ArchiveConfirm({
  label,
  title = "アーカイブしますか？",
  description,
  confirmLabel = "アーカイブ",
  triggerLabel,
  trigger,
  triggerContent,
  onConfirm,
}: {
  label: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  triggerLabel?: string;
  trigger?: ReactElement;
  triggerContent?: ReactNode;
  onConfirm: () => void | Promise<void>;
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="ghost" aria-label={triggerLabel ?? `${label}をアーカイブ`} />
          )
        }
      >
        {triggerContent ?? <ArchiveIcon />}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ArchiveIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? `「${label}」を通常の一覧から非表示にします。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

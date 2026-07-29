import { Archive, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublishStatus } from "@/features/website/website-api";

export function PublishStatusBadge({ status }: { status: PublishStatus }): ReactNode {
  return (
    <Badge variant={status === "published" ? "default" : "secondary"}>
      {status === "published" ? "公開中" : "下書き"}
    </Badge>
  );
}

export function ArchiveConfirm({
  label,
  onConfirm,
}: {
  label: string;
  onConfirm: () => Promise<void>;
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button size="sm" variant="ghost" aria-label={`${label}をアーカイブ`} />}
      >
        <Archive />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Archive />
          </AlertDialogMedia>
          <AlertDialogTitle>アーカイブしますか？</AlertDialogTitle>
          <AlertDialogDescription>
            「{label}」は公開を終了し、通常の一覧から非表示になります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>
            アーカイブ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CopyButton({
  value,
  label = "コピー",
}: {
  value: string;
  label?: string;
}): ReactNode {
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("クリップボードにコピーしました");
    } catch {
      toast.error("コピーできませんでした");
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void copy()}>
      <Copy data-icon="inline-start" />
      {label}
    </Button>
  );
}

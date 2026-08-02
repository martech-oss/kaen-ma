import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

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

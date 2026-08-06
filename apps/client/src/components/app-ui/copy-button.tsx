import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Copies `value` to the clipboard. With a `label`, renders as a labeled outline button; without one, an icon-only button. */
export function CopyButton({ value, label }: { value: string; label?: string }): ReactNode {
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("クリップボードにコピーしました");
    } catch {
      toast.error("コピーできませんでした");
    }
  }

  if (!label) {
    return (
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`${value}をコピー`}
        onClick={() => void copy()}
      >
        <Copy />
      </Button>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void copy()}>
      <Copy data-icon="inline-start" />
      {label}
    </Button>
  );
}

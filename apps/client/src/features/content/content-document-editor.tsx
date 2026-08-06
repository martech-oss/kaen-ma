import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ContentDocument, EmailBlock } from "@openengage/core/web";

export function ContentDocumentEditor({
  value,
  onChange,
}: {
  value: ContentDocument;
  onChange: (value: ContentDocument) => void;
}): ReactNode {
  function updateBlock(index: number, block: EmailBlock): void {
    onChange({ ...value, blocks: value.blocks.map((item, at) => (at === index ? block : item)) });
  }

  function moveBlock(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= value.blocks.length) return;
    const blocks = [...value.blocks];
    const current = blocks[index];
    const other = blocks[target];
    if (!current || !other) return;
    blocks[index] = other;
    blocks[target] = current;
    onChange({ ...value, blocks });
  }

  function addBlock(type: "text" | "image" | "button" | "divider" | "spacer"): void {
    const id = `${type}-${crypto.randomUUID()}`;
    const block: EmailBlock =
      type === "text"
        ? { id, type, html: "<p>本文を入力してください。</p>" }
        : type === "image"
          ? { id, type, src: "https://example.com/image.png", alt: "" }
          : type === "button"
            ? { id, type, label: "詳しく見る", href: "https://example.com", color: "#171717" }
            : type === "spacer"
              ? { id, type, height: 24 }
              : { id, type };
    onChange({ ...value, blocks: [...value.blocks, block] });
  }

  return (
    <Field>
      <FieldLabel>本文ブロック</FieldLabel>
      <FieldDescription>
        ブロックの順序と内容を編集します。変数は {"{{ contact.* }}"} / {"{{ workspace.* }}"} /{" "}
        {"{{ message.* }}"} の形式です。
      </FieldDescription>
      <div className="grid gap-3">
        {value.blocks.map((block, index) => (
          <div key={block.id} className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{blockLabel(block)}</span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="上へ移動"
                  disabled={index === 0}
                  onClick={() => moveBlock(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="下へ移動"
                  disabled={index === value.blocks.length - 1}
                  onClick={() => moveBlock(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="ブロックを削除"
                  onClick={() =>
                    onChange({
                      ...value,
                      blocks: value.blocks.filter((_, at) => at !== index),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            {block.type === "text" ? (
              <Textarea
                aria-label="HTML本文"
                rows={6}
                value={block.html}
                onChange={(event) => updateBlock(index, { ...block, html: event.target.value })}
              />
            ) : block.type === "image" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="画像URL"
                  type="url"
                  value={block.src}
                  onChange={(event) => updateBlock(index, { ...block, src: event.target.value })}
                />
                <Input
                  aria-label="代替テキスト"
                  value={block.alt}
                  placeholder="代替テキスト"
                  onChange={(event) => updateBlock(index, { ...block, alt: event.target.value })}
                />
              </div>
            ) : block.type === "button" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  aria-label="ボタンラベル"
                  value={block.label}
                  onChange={(event) => updateBlock(index, { ...block, label: event.target.value })}
                />
                <Input
                  aria-label="ボタンURL"
                  value={block.href}
                  onChange={(event) => updateBlock(index, { ...block, href: event.target.value })}
                />
                <Input
                  aria-label="ボタン色"
                  type="color"
                  className="w-14"
                  value={block.color}
                  onChange={(event) => updateBlock(index, { ...block, color: event.target.value })}
                />
              </div>
            ) : block.type === "spacer" ? (
              <Input
                aria-label="余白の高さ"
                type="number"
                min={4}
                max={200}
                value={block.height}
                onChange={(event) =>
                  updateBlock(index, { ...block, height: Number(event.target.value) })
                }
              />
            ) : block.type === "conditional" ? (
              <p className="text-sm text-muted-foreground">
                条件ブロックは現在の内容を保持します。詳細編集は今後対応します。
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(["text", "image", "button", "divider", "spacer"] as const).map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addBlock(type)}
          >
            <Plus data-icon="inline-start" />
            {blockTypeLabels[type]}
          </Button>
        ))}
      </div>
    </Field>
  );
}

export function defaultContentDocument(width = 600): ContentDocument {
  return {
    schemaVersion: 1,
    backgroundColor: "#f4f5f7",
    contentColor: "#ffffff",
    width,
    blocks: [{ id: "body", type: "text", html: "<p>本文を入力してください。</p>" }],
  };
}

function blockLabel(block: EmailBlock): string {
  return blockTypeLabels[block.type];
}

const blockTypeLabels = {
  text: "テキスト",
  image: "画像",
  button: "ボタン",
  divider: "区切り線",
  spacer: "余白",
  conditional: "条件分岐",
} as const;

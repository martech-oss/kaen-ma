import { rpc } from "@/rpc";
import {
  AppDialog,
  EmptyState,
  ErrorAlert,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  FormTextarea,
  LoadingButton,
  PageLayout,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LandingPageRow } from "@/features/website/website-api";
import {
  ArchiveConfirm,
  CopyButton,
  PublishStatusBadge,
} from "@/features/website/website-shared";
import { formatDateTime } from "@/lib/format";
import { slugify } from "@/lib/utils";
import type { ContentDocument } from "@kaenma/shared";
import { useRouter } from "@tanstack/react-router";
import { ExternalLink, FileStack, Globe2, Pencil, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

export function LandingPagesPage({
  items,
  workspaceSlug,
}: {
  items: LandingPageRow[];
  workspaceSlug: string;
}): ReactNode {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LandingPageRow | null>(null);

  async function refresh(): Promise<void> {
    setDialogOpen(false);
    setEditing(null);
    await router.invalidate({ sync: true });
  }

  async function archive(item: LandingPageRow): Promise<void> {
    try {
      await rpc(`/pages/${item.id}/archive`, { method: "POST" });
      toast.success("ランディングページをアーカイブしました");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "アーカイブできませんでした");
    }
  }

  return (
    <PageLayout
      title="ランディングページ"
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          ページを作成
        </Button>
      }
    >
      <LandingSummary items={items} />
      {items.length === 0 ? (
        <EmptyState
          title="ランディングページがありません"
          description="見出し、本文、CTAを入力して最初のページを作成してください。"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>ページ一覧</CardTitle>
            <CardDescription>
              公開URLと現在のバージョンを管理します。
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>バージョン</TableHead>
                  <TableHead>更新日時</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const publicUrl = `${window.location.origin}/p/${workspaceSlug}/${item.slug}`;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-xs text-muted-foreground">
                            /{item.slug}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <PublishStatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>v{item.version}</TableCell>
                      <TableCell>{formatDateTime(item.updated_at)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <CopyButton value={publicUrl} label="URL" />
                          {item.status === "published" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              render={
                                <a
                                  href={publicUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                />
                              }
                            >
                              <ExternalLink data-icon="inline-start" />
                              表示
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${item.name}を編集`}
                            onClick={() => {
                              setEditing(item);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <ArchiveConfirm
                            label={item.name}
                            onConfirm={() => archive(item)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AppDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "ランディングページを編集" : "ランディングページを作成"}
        description="保存するたびに新しいページバージョンを作成します。"
        className="sm:max-w-2xl"
      >
        <LandingPageEditor
          key={editing?.id ?? "new"}
          item={editing}
          onSaved={refresh}
        />
      </AppDialog>
    </PageLayout>
  );
}

function LandingSummary({ items }: { items: LandingPageRow[] }): ReactNode {
  const published = items.filter((item) => item.status === "published").length;
  const latestVersion = items.reduce(
    (version, item) => Math.max(version, item.version),
    0,
  );
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        {
          label: "ページ",
          value: items.length,
          description: "現在のページ数",
          icon: FileStack,
        },
        {
          label: "公開中",
          value: published,
          description: "公開URLから閲覧可能",
          icon: Globe2,
        },
        {
          label: "最新バージョン",
          value: latestVersion,
          description: "保存履歴の最大値",
          icon: Pencil,
        },
      ].map((item) => (
        <Card key={item.label}>
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-2xl">{item.value}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <item.icon />
            {item.description}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LandingPageEditor({
  item,
  onSaved,
}: {
  item: LandingPageRow | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = readLandingContent(item?.content_document);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      await rpc(item ? `/pages/${item.id}` : "/pages", {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify({
          name,
          slug: String(formData.get("slug") ?? "").trim() || slugify(name),
          status: formData.get("status"),
          content: buildLandingContent({
            headline: String(formData.get("headline") ?? ""),
            body: String(formData.get("body") ?? ""),
            ctaLabel: String(formData.get("ctaLabel") ?? ""),
            ctaUrl: String(formData.get("ctaUrl") ?? ""),
          }),
        }),
      });
      toast.success(item ? "ページを更新しました" : "ページを作成しました");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput
            label="管理用の名前"
            name="name"
            defaultValue={item?.name}
            placeholder="春のキャンペーン"
            required
          />
          <FormInput
            label="スラッグ"
            name="slug"
            defaultValue={item?.slug}
            description="未入力なら名前から自動生成します。"
            placeholder="spring-campaign"
          />
        </div>
        <FormNativeSelect
          label="公開状態"
          name="status"
          defaultValue={item?.status ?? "draft"}
        >
          <FormSelectOption value="draft">下書き</FormSelectOption>
          <FormSelectOption value="published">公開</FormSelectOption>
        </FormNativeSelect>
        <FormInput
          label="見出し"
          name="headline"
          defaultValue={current.headline}
          placeholder="マーケティングを、もっとシンプルに。"
          required
        />
        <FormTextarea
          label="本文"
          name="body"
          defaultValue={current.body}
          rows={4}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput
            label="CTAラベル"
            name="ctaLabel"
            defaultValue={current.ctaLabel}
            placeholder="無料で始める"
          />
          <FormInput
            label="CTAリンク"
            name="ctaUrl"
            type="url"
            defaultValue={current.ctaUrl}
            placeholder="https://example.com/signup"
          />
        </div>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} type="submit" className="w-full">
          {item ? "新しいバージョンを保存" : "ページを作成"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function buildLandingContent(values: {
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): ContentDocument {
  return {
    schemaVersion: 1,
    backgroundColor: "#f4f5f7",
    contentColor: "#ffffff",
    width: 720,
    blocks: [
      {
        id: "hero",
        type: "text",
        html: `<h1>${values.headline}</h1><p>${values.body}</p>`,
      },
      ...(values.ctaLabel && values.ctaUrl
        ? [
            {
              id: "cta",
              type: "button" as const,
              label: values.ctaLabel,
              href: values.ctaUrl,
              color: "#171717",
            },
          ]
        : []),
    ],
  };
}

function readLandingContent(document?: ContentDocument): {
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
} {
  const text = document?.blocks.find((block) => block.type === "text");
  const button = document?.blocks.find((block) => block.type === "button");
  const html = text?.type === "text" ? text.html : "";
  return {
    headline: decodeBasicHtml(html.match(/<h1>(.*?)<\/h1>/i)?.[1] ?? ""),
    body: decodeBasicHtml(html.match(/<p>(.*?)<\/p>/i)?.[1] ?? ""),
    ctaLabel: button?.type === "button" ? button.label : "",
    ctaUrl: button?.type === "button" ? button.href : "",
  };
}

function decodeBasicHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

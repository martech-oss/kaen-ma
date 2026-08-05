import type { ContentDocument } from "@openengage/orpc";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ExternalLink, FileStack, Globe2, Image as ImageIcon, Pencil, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  ArchiveConfirm,
  FormDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
} from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { AssetPickerDialog } from "@/features/assets/asset-picker";
import {
  ContentDocumentEditor,
  defaultContentDocument,
} from "@/features/content/content-document-editor";
import { landingPagesQueryOptions, type LandingPageRow } from "@/features/website/website-api";
import { CopyButton, PublishStatusBadge } from "@/features/website/website-shared";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { formatDateTime } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";
import { getFormString, slugify } from "@/lib/utils";

export function LandingPagesPage({ workspaceSlug }: { workspaceSlug: string }): ReactNode {
  const queryClient = useQueryClient();
  const { data: items } = useSuspenseQuery(landingPagesQueryOptions());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LandingPageRow | null>(null);

  const archivePage = useMutation(orpcQuery.website.archivePage.mutationOptions());

  async function refresh(): Promise<void> {
    setDialogOpen(false);
    setEditing(null);
    await queryClient.invalidateQueries({ queryKey: orpcQuery.website.listPages.key() });
  }

  async function archive(item: LandingPageRow): Promise<void> {
    try {
      await archivePage.mutateAsync({ id: item.id });
      toast.success("ランディングページをアーカイブしました");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "アーカイブできませんでした");
    }
  }

  const columns: DataTableColumn<LandingPageRow>[] = [
    {
      key: "name",
      header: "名前",
      cell: (item) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">/{item.slug}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "状態",
      cell: (item) => <PublishStatusBadge status={item.status} />,
    },
    {
      key: "version",
      header: "バージョン",
      cell: (item) => `v${item.version}`,
    },
    {
      key: "updatedAt",
      header: "更新日時",
      cell: (item) => formatDateTime(item.updatedAt),
    },
    {
      key: "actions",
      header: "操作",
      cell: (item) => {
        const publicUrl = `${window.location.origin}/p/${workspaceSlug}/${item.slug}`;
        return (
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
                    aria-label={`${item.name}を表示`}
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
              description={`「${item.name}」は公開を終了し、通常の一覧から非表示になります。`}
              onConfirm={() => archive(item)}
            />
          </div>
        );
      },
      headClassName: "text-right",
    },
  ];

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
      <Card>
        <CardHeader>
          <CardTitle>ページ一覧</CardTitle>
          <CardDescription>公開URLと現在のバージョンを管理します。</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(item) => item.id}
            caption="ページ一覧"
            emptyTitle="ランディングページがありません"
            emptyDescription="見出し、本文、CTAを入力して最初のページを作成してください。"
          />
        </CardContent>
      </Card>

      <LandingPageEditor
        key={editing?.id ?? "new"}
        item={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={refresh}
      />
    </PageLayout>
  );
}

function LandingSummary({ items }: { items: LandingPageRow[] }): ReactNode {
  const published = items.filter((item) => item.status === "published").length;
  const latestVersion = items.reduce((version, item) => Math.max(version, item.version ?? 0), 0);
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
  open,
  onOpenChange,
  onSaved,
}: {
  item: LandingPageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { busy, error, run } = useFormSubmission("保存できませんでした");
  const [content, setContent] = useState<ContentDocument>(
    item?.contentDocument ?? defaultContentDocument(720),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const createPage = useMutation(orpcQuery.website.createPage.mutationOptions());
  const updatePage = useMutation(orpcQuery.website.updatePage.mutationOptions());

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = getFormString(formData, "name").trim();
    const payload = {
      name,
      slug: getFormString(formData, "slug").trim() || slugify(name),
      status: getFormString(formData, "status") === "published" ? "published" : "draft",
      content,
    } as const;
    await run(async () => {
      await (item
        ? updatePage.mutateAsync({ id: item.id, ...payload })
        : createPage.mutateAsync(payload));
      toast.success(item ? "ページを更新しました" : "ページを作成しました");
      await onSaved();
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "ランディングページを編集" : "ランディングページを作成"}
      description="保存するたびに新しいページバージョンを作成します。"
      className="sm:max-w-2xl"
      onSubmit={(event) => void submit(event)}
      busy={busy}
      error={error}
      submitLabel={item ? "新しいバージョンを保存" : "ページを作成"}
    >
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
      <FormNativeSelect label="公開状態" name="status" defaultValue={item?.status ?? "draft"}>
        <FormSelectOption value="draft">下書き</FormSelectOption>
        <FormSelectOption value="published">公開</FormSelectOption>
      </FormNativeSelect>
      <ContentDocumentEditor value={content} onChange={setContent} />
      <Field>
        <FieldLabel>アセット画像</FieldLabel>
        <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <ImageIcon data-icon="inline-start" />
          画像ブロックを追加
        </Button>
        <FieldDescription>公開設定のアセットを本文の末尾へ追加します。</FieldDescription>
      </Field>
      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(asset) => {
          if (asset.publicUrl) {
            setContent((current) => ({
              ...current,
              blocks: [
                ...current.blocks,
                {
                  id: `image-${crypto.randomUUID()}`,
                  type: "image",
                  src: asset.publicUrl ?? "",
                  alt: asset.name,
                },
              ],
            }));
          }
          setPickerOpen(false);
        }}
      />
    </FormDialog>
  );
}

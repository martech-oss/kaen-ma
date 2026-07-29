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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import type { SiteMessageRow } from "@/features/website/website-api";
import {
  ArchiveConfirm,
  PublishStatusBadge,
} from "@/features/website/website-shared";
import { formatDateTime } from "@/lib/format";
import { useRouter } from "@tanstack/react-router";
import {
  Eye,
  Link as LinkIcon,
  MessageSquareText,
  MousePointerClick,
  Pencil,
  Plus,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

export function SiteMessagesPage({
  items,
}: {
  items: SiteMessageRow[];
}): ReactNode {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SiteMessageRow | null>(null);

  async function refresh(): Promise<void> {
    setDialogOpen(false);
    setEditing(null);
    await router.invalidate({ sync: true });
  }

  async function archive(item: SiteMessageRow): Promise<void> {
    try {
      await rpc(`/site-messages/${item.id}/archive`, { method: "POST" });
      toast.success("サイトメッセージをアーカイブしました");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "アーカイブできませんでした");
    }
  }

  return (
    <PageLayout
      title="サイトメッセージ"
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          メッセージを作成
        </Button>
      }
    >
      <Alert>
        <LinkIcon />
        <AlertTitle>サイトトラッキングと連動します</AlertTitle>
        <AlertDescription>
          許可ドメインで識別された連絡先にのみ表示します。匿名の訪問者には表示しません。
        </AlertDescription>
      </Alert>
      <MessageSummary items={items} />
      {items.length === 0 ? (
        <EmptyState
          title="サイトメッセージがありません"
          description="ページ条件と表示期間を指定して、最初のメッセージを作成してください。"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>メッセージ一覧</CardTitle>
            <CardDescription>
              公開状態、ページ条件、表示・クリック実績を確認できます。
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>ページ条件</TableHead>
                  <TableHead className="text-right">表示</TableHead>
                  <TableHead className="text-right">クリック</TableHead>
                  <TableHead>更新日時</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex max-w-80 flex-col gap-1">
                        <span className="font-medium">{item.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.headline}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PublishStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{item.page_pattern}</code>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.impression_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.click_count.toLocaleString()}
                    </TableCell>
                    <TableCell>{formatDateTime(item.updated_at)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
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
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AppDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "サイトメッセージを編集" : "サイトメッセージを作成"}
        description="サイト右下に表示する内容と対象ページを設定します。"
        className="sm:max-w-2xl"
      >
        <SiteMessageEditor
          key={editing?.id ?? "new"}
          item={editing}
          onSaved={refresh}
        />
      </AppDialog>
    </PageLayout>
  );
}

function MessageSummary({ items }: { items: SiteMessageRow[] }): ReactNode {
  const impressions = items.reduce(
    (total, item) => total + item.impression_count,
    0,
  );
  const clicks = items.reduce((total, item) => total + item.click_count, 0);
  const clickRate = impressions > 0 ? (clicks / impressions) * 100 : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        {
          label: "メッセージ",
          value: items.length.toLocaleString(),
          description: "現在のメッセージ数",
          icon: MessageSquareText,
        },
        {
          label: "公開中",
          value: items
            .filter((item) => item.status === "published")
            .length.toLocaleString(),
          description: "配信条件の評価対象",
          icon: LinkIcon,
        },
        {
          label: "表示",
          value: impressions.toLocaleString(),
          description: "識別済み連絡先への表示",
          icon: Eye,
        },
        {
          label: "クリック率",
          value: `${clickRate.toFixed(1)}%`,
          description: `${clicks.toLocaleString()}クリック`,
          icon: MousePointerClick,
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

function SiteMessageEditor({
  item,
  onSaved,
}: {
  item: SiteMessageRow | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const ctaUrl = String(formData.get("ctaUrl") ?? "").trim();
    const startsAt = dateTimeValue(formData.get("startsAt"));
    const endsAt = dateTimeValue(formData.get("endsAt"));
    if (startsAt && endsAt && startsAt >= endsAt) {
      setError("終了日時は開始日時より後にしてください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await rpc(item ? `/site-messages/${item.id}` : "/site-messages", {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          status: formData.get("status"),
          headline: formData.get("headline"),
          body: formData.get("body"),
          ctaLabel: formData.get("ctaLabel"),
          ctaUrl: ctaUrl || null,
          pagePattern: formData.get("pagePattern"),
          startsAt,
          endsAt,
        }),
      });
      toast.success(
        item ? "サイトメッセージを更新しました" : "サイトメッセージを作成しました",
      );
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
            placeholder="料金ページの案内"
            required
          />
          <FormNativeSelect
            label="公開状態"
            name="status"
            defaultValue={item?.status ?? "draft"}
          >
            <FormSelectOption value="draft">下書き</FormSelectOption>
            <FormSelectOption value="published">公開</FormSelectOption>
          </FormNativeSelect>
        </div>
        <FormInput
          label="見出し"
          name="headline"
          defaultValue={item?.headline}
          placeholder="ご不明な点はありませんか？"
          required
        />
        <FormTextarea
          label="本文"
          name="body"
          defaultValue={item?.body}
          rows={3}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput
            label="CTAラベル"
            name="ctaLabel"
            defaultValue={item?.cta_label ?? ""}
            placeholder="相談する"
          />
          <FormInput
            label="CTAリンク"
            name="ctaUrl"
            type="url"
            defaultValue={item?.cta_url ?? ""}
            placeholder="https://example.com/contact"
          />
        </div>
        <FormInput
          label="対象ページ"
          name="pagePattern"
          defaultValue={item?.page_pattern ?? "*"}
          description="* はすべてのページ、/pricing* は料金ページ配下を表します。"
          placeholder="/pricing*"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput
            label="表示開始"
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalDateTime(item?.starts_at)}
          />
          <FormInput
            label="表示終了"
            name="endsAt"
            type="datetime-local"
            defaultValue={toLocalDateTime(item?.ends_at)}
          />
        </div>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} type="submit" className="w-full">
          {item ? "変更を保存" : "メッセージを作成"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function dateTimeValue(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  return raw ? new Date(raw).toISOString() : null;
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

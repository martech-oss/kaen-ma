import {
  AppDialog,
  EmptyState,
  ErrorAlert,
  FormInput,
  FormTextarea,
  LoadingButton,
  PageLayout,
} from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadContactResources,
  type ContactResources,
} from "@/features/contacts/contact-resource-api";
import { ListChecks, Plus, Tags } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";

function useContactResources(initialResources: ContactResources): {
  resources: ContactResources;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
} {
  const [resources, setResources] =
    useState<ContactResources>(initialResources);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setResources(await loadContactResources());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "コンタクト設定を読み込めませんでした",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return { resources, loading, error, load };
}

export function ContactListsPage({
  initialResources,
}: {
  initialResources: ContactResources;
}): ReactNode {
  const { resources, loading, error, load } =
    useContactResources(initialResources);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <PageLayout
      title="リスト"
      action={
        <Button onClick={() => setShowCreate(true)}>
          <Plus data-icon="inline-start" />
          リストを作成
        </Button>
      }
    >
      {error ? <ResourceLoadError message={error} onRetry={load} /> : null}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>すべてのリスト</CardTitle>
          <CardDescription>
            リスト名、説明、登録されている連絡先数を確認できます。
          </CardDescription>
          <CardAction>
            {loading ? (
              <Skeleton className="h-5 w-12 rounded-full" />
            ) : (
              <Badge variant="secondary">{resources.lists.length}件</Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableCaption className="sr-only">
              コンタクトリスト一覧
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">リスト</TableHead>
                <TableHead>説明</TableHead>
                <TableHead>スラッグ</TableHead>
                <TableHead className="px-4 text-right">連絡先</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <ResourceTableSkeleton columns={4} />
              ) : (
                resources.lists.map((list) => (
                  <TableRow key={list.id}>
                    <TableCell className="px-4 font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: list.color }}
                        />
                        {list.name}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-sm whitespace-normal text-muted-foreground">
                      {list.description || "説明なし"}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {list.slug}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Badge variant="secondary">
                        {Number(list.contact_count).toLocaleString()}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!loading && resources.lists.length === 0 ? (
            <EmptyState
              compact
              title="リストがまだありません"
              description="配信先や運用目的に合わせた最初のリストを作成しましょう。"
              action={
                <Button variant="outline" onClick={() => setShowCreate(true)}>
                  <ListChecks data-icon="inline-start" />
                  リストを作成
                </Button>
              }
            />
          ) : null}
        </CardContent>
      </Card>
      <AppDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="リストを作成"
        description="連絡先をまとめるための名前と説明を設定します。"
      >
        <CreateListForm
          onSaved={async () => {
            await load();
            setShowCreate(false);
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

export function ContactTagsPage({
  initialResources,
}: {
  initialResources: ContactResources;
}): ReactNode {
  const { resources, loading, error, load } =
    useContactResources(initialResources);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <PageLayout
      title="タグ"
      action={
        <Button onClick={() => setShowCreate(true)}>
          <Plus data-icon="inline-start" />
          タグを作成
        </Button>
      }
    >
      {error ? <ResourceLoadError message={error} onRetry={load} /> : null}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>すべてのタグ</CardTitle>
          <CardDescription>
            タグごとの利用数と識別用スラッグを確認できます。
          </CardDescription>
          <CardAction>
            {loading ? (
              <Skeleton className="h-5 w-12 rounded-full" />
            ) : (
              <Badge variant="secondary">{resources.tags.length}件</Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableCaption className="sr-only">コンタクトタグ一覧</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">タグ</TableHead>
                <TableHead>カラー</TableHead>
                <TableHead>スラッグ</TableHead>
                <TableHead className="px-4 text-right">連絡先</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <ResourceTableSkeleton columns={4} />
              ) : (
                resources.tags.map((tag) => (
                  <TableRow key={tag.id}>
                    <TableCell className="px-4 font-medium">
                      <Badge variant="outline">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {tag.color.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {tag.slug}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Badge variant="secondary">
                        {Number(tag.contact_count).toLocaleString()}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!loading && resources.tags.length === 0 ? (
            <EmptyState
              compact
              title="タグがまだありません"
              description="検索や分類に使う最初のタグを作成しましょう。"
              action={
                <Button variant="outline" onClick={() => setShowCreate(true)}>
                  <Tags data-icon="inline-start" />
                  タグを作成
                </Button>
              }
            />
          ) : null}
        </CardContent>
      </Card>
      <AppDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="タグを作成"
        description="連絡先を識別するラベルとカラーを設定します。"
      >
        <CreateTagForm
          onSaved={async () => {
            await load();
            setShowCreate(false);
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function ResourceLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <ErrorAlert>{message}</ErrorAlert>
      <Button
        className="self-start"
        variant="outline"
        onClick={() => void onRetry()}
      >
        再読み込み
      </Button>
    </div>
  );
}

function ResourceTableSkeleton({ columns }: { columns: number }): ReactNode {
  return Array.from({ length: 4 }, (_, rowIndex) => (
    <TableRow key={rowIndex}>
      {Array.from({ length: columns }, (_, columnIndex) => (
        <TableCell
          key={columnIndex}
          className={columnIndex === 0 ? "px-4" : undefined}
        >
          <Skeleton className={columnIndex === 0 ? "h-4 w-32" : "h-4 w-20"} />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function CreateListForm({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/contact-lists", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description"),
          color: form.get("color"),
        }),
      });
      await onSaved();
      toast.success("リストを作成しました");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "リストを作成できませんでした",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="名前"
          name="name"
          placeholder="例：ニュースレター購読者"
          autoFocus
          required
        />
        <FormTextarea
          label="説明"
          name="description"
          placeholder="このリストの用途を入力"
          rows={3}
        />
        <FormInput
          label="カラー"
          name="color"
          type="color"
          defaultValue="#6366f1"
          description="一覧や連絡先詳細での識別に使用します。"
          required
        />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="作成中…" type="submit">
          作成
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function CreateTagForm({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/tags", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          color: form.get("color"),
        }),
      });
      await onSaved();
      toast.success("タグを作成しました");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "タグを作成できませんでした",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="名前"
          name="name"
          placeholder="例：ホットリード"
          autoFocus
          required
        />
        <FormInput
          label="カラー"
          name="color"
          type="color"
          defaultValue="#64748b"
          description="検索結果やプロフィールでの識別に使用します。"
          required
        />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="作成中…" type="submit">
          作成
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

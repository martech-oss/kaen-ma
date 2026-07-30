import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  ChevronDown,
  Filter,
  ListPlus,
  Plus,
  RefreshCw,
  Search,
  Tags,
  UsersRound,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";

import { AppDialog, ErrorAlert as ErrorNotice, PageLayout as Page } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  contactOptionsQueryKey,
  contactOptionsQueryOptions,
  type ContactSearch,
  type ContactSort,
  contactsQueryOptions,
  type ContactStatus,
} from "@/features/contacts/contact-api";
import { formatLongDateTime } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { rpc } from "@/rpc";
import { type SegmentFilter } from "@kaenma/shared/segments";

import {
  type BulkAction,
  ColorChip,
  ContactAvatar,
  contactName,
  ContactStatusBadge,
  ControlledSelect,
  SelectField,
  TextField,
} from "./contact-bits";
import { ContactDrawer } from "./contact-drawer";
import { useContactFilters } from "./contact-filters";
import { ContactCreateForm, SegmentSaveForm } from "./contact-forms";

export function ContactsPage({ initialSearch }: { initialSearch: ContactSearch }): ReactNode {
  const queryClient = useQueryClient();
  const contactsQuery = useSuspenseQuery(contactsQueryOptions(initialSearch));
  const optionsQuery = useSuspenseQuery(contactOptionsQueryOptions());
  const contacts = contactsQuery.data.items;
  const options = optionsQuery.data;
  const total = contactsQuery.data.total;
  const loading = contactsQuery.isFetching;
  const [error, setError] = useState("");
  const {
    query,
    setQuery,
    status,
    setStatus,
    stage,
    setStage,
    tagId,
    setTagId,
    listId,
    setListId,
    accountId,
    setAccountId,
    segmentId,
    setSegmentId,
    scoreMin,
    setScoreMin,
    scoreMax,
    setScoreMax,
    sort,
    setSort,
    direction,
    setDirection,
    hasAdvancedFilters,
    clearFilters,
  } = useContactFilters(initialSearch);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSegmentSave, setShowSegmentSave] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction>("add_tag");
  const [bulkResourceId, setBulkResourceId] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshContacts = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: orpcQuery.contacts.list.key({ type: "query" }),
    });
    setSelected(new Set());
  }, [queryClient]);

  const refreshOptions = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: contactOptionsQueryKey,
      }),
    [queryClient],
  );

  const refreshContactData = useCallback(async () => {
    await Promise.all([refreshContacts(), refreshOptions()]);
  }, [refreshContacts, refreshOptions]);

  const selectedSegment = options.segments.find((segment) => segment.id === segmentId);
  const allVisibleSelected =
    contacts.length > 0 && contacts.every((contact) => selected.has(contact.id));

  async function applyBulkAction() {
    if (selected.size === 0) return;
    const needsResource = !["archive", "restore"].includes(bulkAction);
    if (needsResource && !bulkResourceId) {
      setError("一括操作の対象を選択してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await rpc("/contact-actions", {
        method: "POST",
        body: JSON.stringify({
          contactIds: [...selected],
          action: bulkAction,
          ...(needsResource ? { resourceId: bulkResourceId } : {}),
        }),
      });
      await refreshContactData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "一括操作に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function refreshSegment() {
    if (!segmentId) return;
    setBusy(true);
    try {
      await rpc(`/segments/${segmentId}/refresh`, { method: "POST" });
      await refreshContactData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "セグメントを更新できませんでした");
    } finally {
      setBusy(false);
    }
  }

  function buildSegmentFilter(): SegmentFilter | null {
    const children: SegmentFilter[] = [];
    if (query.trim()) {
      children.push({
        kind: "group",
        combinator: "or",
        children: [
          {
            kind: "condition",
            field: "email",
            operator: "contains",
            value: query.trim(),
          },
          {
            kind: "condition",
            field: "first_name",
            operator: "contains",
            value: query.trim(),
          },
          {
            kind: "condition",
            field: "last_name",
            operator: "contains",
            value: query.trim(),
          },
        ],
      });
    }
    if (status !== "all") {
      children.push({
        kind: "condition",
        field: "status",
        operator: "eq",
        value: status,
      });
    }
    if (stage)
      children.push({
        kind: "condition",
        field: "stage",
        operator: "eq",
        value: stage,
      });
    if (scoreMin) {
      children.push({
        kind: "condition",
        field: "score",
        operator: "gte",
        value: Number(scoreMin),
      });
    }
    if (scoreMax) {
      children.push({
        kind: "condition",
        field: "score",
        operator: "lte",
        value: Number(scoreMax),
      });
    }
    const tag = options.tags.find((item) => item.id === tagId);
    if (tag)
      children.push({
        kind: "condition",
        field: "tag",
        operator: "eq",
        value: tag.slug,
      });
    const list = options.lists.find((item) => item.id === listId);
    if (list) {
      children.push({
        kind: "condition",
        field: "list",
        operator: "eq",
        value: list.slug,
      });
    }
    const account = options.accounts.find((item) => item.id === accountId);
    if (account) {
      children.push({
        kind: "condition",
        field: "company",
        operator: "eq",
        value: account.name,
      });
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { kind: "group", combinator: "and", children };
  }

  return (
    <Page
      title="連絡先"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/accounts" />}>
            <Building2 data-icon="inline-start" />
            アカウント
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/tags" />}>
            <Tags data-icon="inline-start" />
            タグ
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/lists" />}>
            <ListPlus data-icon="inline-start" />
            リスト
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus data-icon="inline-start" />
            連絡先を追加
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          value={[status]}
          onValueChange={(values) => {
            const nextStatus = values[0] as ContactStatus | undefined;
            if (nextStatus) setStatus(nextStatus);
          }}
          variant="outline"
          spacing={0}
        >
          <ToggleGroupItem value="active">有効</ToggleGroupItem>
          <ToggleGroupItem value="all">すべて</ToggleGroupItem>
          <ToggleGroupItem value="archived">アーカイブ</ToggleGroupItem>
          <ToggleGroupItem value="anonymous">匿名</ToggleGroupItem>
        </ToggleGroup>
        <Badge variant="secondary">{total.toLocaleString()}件</Badge>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap gap-2">
            <InputGroup className="min-w-64 flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="名前、メール、電話番号、外部IDで検索"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={() => setQuery("")}
                    aria-label="検索をクリア"
                  >
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
            <ControlledSelect
              value={tagId}
              onValueChange={setTagId}
              placeholder="すべてのタグ"
              options={options.tags.map((tag) => ({
                value: tag.id,
                label: tag.name,
              }))}
            />
            <ControlledSelect
              value={listId}
              onValueChange={setListId}
              placeholder="すべてのリスト"
              options={options.lists.map((list) => ({
                value: list.id,
                label: list.name,
              }))}
            />
            <ControlledSelect
              value={accountId}
              onValueChange={setAccountId}
              placeholder="すべてのアカウント"
              className="min-w-44"
              options={options.accounts.map((account) => ({
                value: account.id,
                label: account.name,
              }))}
            />
            <ControlledSelect
              value={segmentId}
              onValueChange={setSegmentId}
              placeholder="すべてのセグメント"
              className="min-w-44"
              options={options.segments.map((segment) => ({
                value: segment.id,
                label: segment.name,
              }))}
            />
            <Button
              variant="outline"
              className={cn((advancedOpen || hasAdvancedFilters) && "border-primary text-primary")}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <Filter data-icon="inline-start" />
              詳細検索
              <ChevronDown
                data-icon="inline-end"
                className={cn("transition", advancedOpen && "rotate-180")}
              />
            </Button>
          </div>

          {advancedOpen && (
            <div className="grid gap-3 rounded-lg bg-muted/50 p-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField label="ステージ" value={stage} onChange={setStage}>
                <NativeSelectOption value="">すべて</NativeSelectOption>
                {options.stages.map((item) => (
                  <NativeSelectOption key={item.stage} value={item.stage}>
                    {item.stage} ({item.contact_count})
                  </NativeSelectOption>
                ))}
              </SelectField>
              <TextField label="スコア下限" type="number" value={scoreMin} onChange={setScoreMin} />
              <TextField label="スコア上限" type="number" value={scoreMax} onChange={setScoreMax} />
              <SelectField
                label="並び順"
                value={`${sort}:${direction}`}
                onChange={(value) => {
                  const [nextSort = "updatedAt", nextDirection = "desc"] = value.split(":");
                  setSort(nextSort as ContactSort);
                  setDirection(nextDirection === "asc" ? "asc" : "desc");
                }}
              >
                <NativeSelectOption value="updatedAt:desc">更新が新しい順</NativeSelectOption>
                <NativeSelectOption value="createdAt:desc">作成が新しい順</NativeSelectOption>
                <NativeSelectOption value="score:desc">スコアが高い順</NativeSelectOption>
                <NativeSelectOption value="score:asc">スコアが低い順</NativeSelectOption>
                <NativeSelectOption value="name:asc">名前順</NativeSelectOption>
                <NativeSelectOption value="email:asc">メール順</NativeSelectOption>
              </SelectField>
              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
                <Button variant="outline" onClick={clearFilters}>
                  条件をクリア
                </Button>
                <Button
                  variant="outline"
                  disabled={!buildSegmentFilter() || Boolean(segmentId)}
                  onClick={() => setShowSegmentSave(true)}
                >
                  条件をセグメント保存
                </Button>
                {selectedSegment && (
                  <Button variant="outline" disabled={busy} onClick={() => void refreshSegment()}>
                    <RefreshCw data-icon="inline-start" />
                    セグメントを再評価
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardHeader>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-3">
            <Badge>{selected.size}件を選択中</Badge>
            <ControlledSelect
              value={bulkAction}
              onValueChange={(value) => {
                setBulkAction(value as BulkAction);
                setBulkResourceId("");
              }}
              placeholder="一括操作"
              options={[
                { value: "add_tag", label: "タグを追加" },
                { value: "remove_tag", label: "タグを削除" },
                { value: "add_list", label: "リストへ追加" },
                { value: "remove_list", label: "リストから削除" },
                { value: "archive", label: "アーカイブ" },
                { value: "restore", label: "復元" },
              ]}
            />
            {bulkAction.includes("tag") && (
              <ControlledSelect
                value={bulkResourceId}
                onValueChange={setBulkResourceId}
                placeholder="タグを選択"
                options={options.tags.map((tag) => ({
                  value: tag.id,
                  label: tag.name,
                }))}
              />
            )}
            {bulkAction.includes("list") && (
              <ControlledSelect
                value={bulkResourceId}
                onValueChange={setBulkResourceId}
                placeholder="リストを選択"
                options={options.lists.map((list) => ({
                  value: list.id,
                  label: list.name,
                }))}
              />
            )}
            <Button disabled={busy} onClick={() => void applyBulkAction()}>
              適用
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              選択解除
            </Button>
          </div>
        )}

        {(error || contactsQuery.error || optionsQuery.error) && (
          <div className="border-b p-4">
            <ErrorNotice>
              {error ||
                (contactsQuery.error instanceof Error
                  ? contactsQuery.error.message
                  : optionsQuery.error instanceof Error
                    ? optionsQuery.error.message
                    : "連絡先を読み込めませんでした")}
            </ErrorNotice>
          </div>
        )}
        <CardContent className="px-0">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 px-5">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked ? new Set(contacts.map((contact) => contact.id)) : new Set(),
                      )
                    }
                    aria-label="表示中の連絡先をすべて選択"
                  />
                </TableHead>
                <TableHead>連絡先</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>会社・分類</TableHead>
                <TableHead className="text-right">スコア</TableHead>
                <TableHead className="px-5 text-right">更新日</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell className="px-5">
                        <Skeleton className="size-4" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-8 w-56" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="ml-auto h-6 w-12" />
                      </TableCell>
                      <TableCell className="px-5">
                        <Skeleton className="ml-auto h-4 w-28" />
                      </TableCell>
                    </TableRow>
                  ))
                : contacts.map((contact) => (
                    <TableRow
                      key={contact.id}
                      className="cursor-pointer focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      onClick={() => setActiveContactId(contact.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setActiveContactId(contact.id);
                      }}
                      tabIndex={0}
                    >
                      <TableCell className="px-5" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(contact.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selected);
                            if (checked) next.add(contact.id);
                            else next.delete(contact.id);
                            setSelected(next);
                          }}
                          aria-label={`${contactName(contact)}を選択`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ContactAvatar contact={contact} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{contactName(contact)}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {contact.email ??
                                contact.phone ??
                                contact.externalId ??
                                "匿名Contact"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <ContactStatusBadge status={contact.status} />
                          <Badge variant="outline">{contact.stage}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-80">
                        <div className="flex flex-wrap gap-1">
                          {contact.accounts.slice(0, 1).map((account) => (
                            <Badge key={account.id} variant="secondary">
                              <Building2 />
                              {account.name}
                            </Badge>
                          ))}
                          {contact.tags.slice(0, 3).map((tag) => (
                            <ColorChip key={tag.id} item={tag} />
                          ))}
                          {contact.lists.slice(0, 2).map((list) => (
                            <Badge key={list.id} variant="outline">
                              {list.name}
                            </Badge>
                          ))}
                          {contact.accounts.length + contact.tags.length + contact.lists.length ===
                            0 && <span className="text-xs text-muted-foreground">未分類</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "min-w-12 justify-center tabular-nums",
                            contact.score >= 50 && "bg-success text-success-foreground",
                            contact.score >= 20 &&
                              contact.score < 50 &&
                              "bg-warning text-warning-foreground",
                          )}
                        >
                          {contact.score}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-5 text-right text-xs text-muted-foreground">
                        {formatLongDateTime(contact.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {!loading && contacts.length === 0 && (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>条件に一致する連絡先がありません</EmptyTitle>
                <EmptyDescription>
                  検索条件を変更するか、新しい連絡先を追加してください。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <AppDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="連絡先を追加"
        description="プロフィール、会社、タグ、リストを登録します。"
        className="sm:max-w-2xl"
      >
        <ContactCreateForm
          options={options}
          onSaved={async () => {
            setShowCreate(false);
            await refreshContactData();
          }}
        />
      </AppDialog>
      <AppDialog
        open={showSegmentSave}
        onOpenChange={setShowSegmentSave}
        title="検索条件をセグメントとして保存"
        description="現在の検索条件を動的セグメントに変換します。"
      >
        <SegmentSaveForm
          filter={buildSegmentFilter()}
          onSaved={async () => {
            setShowSegmentSave(false);
            await refreshOptions();
          }}
        />
      </AppDialog>
      {activeContactId && (
        <ContactDrawer
          contactId={activeContactId}
          options={options}
          onClose={() => setActiveContactId(null)}
          onChanged={refreshContactData}
        />
      )}
    </Page>
  );
}

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  Building2,
  Check,
  ChevronDown,
  Filter,
  ListPlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  Tags,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import {
  AppDialog,
  ErrorAlert as ErrorNotice,
  FormInput as InputField,
  FormNativeSelect as SelectInput,
  LoadingButton,
  PageLayout as Page,
} from "@/components/app-ui";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  contactOptionsQueryKey,
  contactOptionsQueryOptions,
  contactsQueryOptions,
  type AccountOption,
  type ContactOptions,
  type ContactSearch,
  type ContactSort,
  type ContactStatus,
  type ListOption,
  type SegmentOption,
  type TagOption,
} from "@/features/contacts/contact-api";
import { orpcQuery } from "@/lib/orpc";
import { cn, getFormString } from "@/lib/utils";
import { rpc } from "@/rpc";
import type { Contact, SegmentFilter } from "@kaenma/shared";

interface ContactProfile {
  contact: Contact;
  tags: TagOption[];
  lists: Array<ListOption & { status: string; updated_at: string }>;
  segments: Array<{
    id: string;
    name: string;
    kind: "static" | "dynamic";
    source: string;
    joined_at: string;
  }>;
  accounts: Array<
    AccountOption & {
      title: string | null;
      is_primary: boolean;
    }
  >;
  scoreEvents: Array<{
    id: string;
    delta: number;
    total: number;
    reason: string;
    created_at: string;
  }>;
  timeline: Array<{
    id: string;
    type: string;
    resource_type: string | null;
    resource_id: string | null;
    properties: Record<string, unknown>;
    occurred_at: string;
  }>;
}

type BulkAction = "add_tag" | "remove_tag" | "add_list" | "remove_list" | "archive" | "restore";

function ControlledSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  className?: string;
}): ReactNode {
  return (
    <Select
      items={options}
      value={value || null}
      onValueChange={(nextValue) => onValueChange(nextValue ?? "")}
    >
      <SelectTrigger className={cn("min-w-40", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ContactsPage({ initialSearch }: { initialSearch: ContactSearch }): ReactNode {
  const queryClient = useQueryClient();
  const contactsQuery = useSuspenseQuery(contactsQueryOptions(initialSearch));
  const optionsQuery = useSuspenseQuery(contactOptionsQueryOptions());
  const contacts = contactsQuery.data.items;
  const options = optionsQuery.data;
  const total = contactsQuery.data.total;
  const loading = contactsQuery.isFetching;
  const [error, setError] = useState("");
  const [query, setQuery] = useState(initialSearch.q);
  const [status, setStatus] = useState<ContactStatus>(initialSearch.status);
  const [stage, setStage] = useState(initialSearch.stage);
  const [tagId, setTagId] = useState(initialSearch.tagId);
  const [listId, setListId] = useState(initialSearch.listId);
  const [accountId, setAccountId] = useState(initialSearch.accountId);
  const [segmentId, setSegmentId] = useState(initialSearch.segmentId);
  const [scoreMin, setScoreMin] = useState(initialSearch.scoreMin);
  const [scoreMax, setScoreMax] = useState(initialSearch.scoreMax);
  const [sort, setSort] = useState(initialSearch.sort);
  const [direction, setDirection] = useState(initialSearch.direction);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSegmentSave, setShowSegmentSave] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction>("add_tag");
  const [bulkResourceId, setBulkResourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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

  useEffect(() => {
    setQuery(initialSearch.q);
    setStatus(initialSearch.status);
    setStage(initialSearch.stage);
    setTagId(initialSearch.tagId);
    setListId(initialSearch.listId);
    setAccountId(initialSearch.accountId);
    setSegmentId(initialSearch.segmentId);
    setScoreMin(initialSearch.scoreMin);
    setScoreMax(initialSearch.scoreMax);
    setSort(initialSearch.sort);
    setDirection(initialSearch.direction);
  }, [initialSearch]);

  useEffect(() => {
    const nextSearch: ContactSearch = {
      q: query,
      status,
      stage,
      tagId,
      listId,
      accountId,
      segmentId,
      scoreMin,
      scoreMax,
      sort,
      direction: direction === "asc" ? "asc" : "desc",
    };
    if (
      Object.keys(nextSearch).every(
        (key) =>
          nextSearch[key as keyof ContactSearch] === initialSearch[key as keyof ContactSearch],
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/contacts",
        search: nextSearch,
        replace: true,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    accountId,
    direction,
    initialSearch,
    listId,
    navigate,
    query,
    scoreMax,
    scoreMin,
    segmentId,
    sort,
    stage,
    status,
    tagId,
  ]);

  const selectedSegment = options.segments.find((segment) => segment.id === segmentId);
  const allVisibleSelected =
    contacts.length > 0 && contacts.every((contact) => selected.has(contact.id));
  const hasAdvancedFilters = Boolean(
    stage || tagId || listId || accountId || segmentId || scoreMin || scoreMax,
  );

  function clearFilters() {
    setQuery("");
    setStage("");
    setTagId("");
    setListId("");
    setAccountId("");
    setSegmentId("");
    setScoreMin("");
    setScoreMax("");
    setSort("updatedAt");
    setDirection("desc");
  }

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
                          <StatusBadge status={contact.status} />
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
                        {formatDate(contact.updatedAt)}
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

function ContactCreateForm({
  options,
  onSaved,
}: {
  options: ContactOptions;
  onSaved: () => Promise<void>;
}): ReactNode {
  const createContact = useMutation(orpcQuery.contacts.create.mutationOptions());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const contact = await createContact.mutateAsync({
        email: optionalString(form.get("email")),
        firstName: optionalString(form.get("firstName")),
        lastName: optionalString(form.get("lastName")),
        phone: optionalString(form.get("phone")),
        externalId: optionalString(form.get("externalId")),
        stage: optionalString(form.get("stage")) ?? "lead",
        customFields: {},
      });
      const tagId = optionalString(form.get("tagId"));
      const listId = optionalString(form.get("listId"));
      const accountId = optionalString(form.get("accountId"));
      await Promise.all([
        tagId
          ? rpc(`/contacts/${contact.id}/tags`, {
              method: "POST",
              body: JSON.stringify({ tagId }),
            })
          : Promise.resolve(),
        listId
          ? rpc(`/contacts/${contact.id}/lists`, {
              method: "POST",
              body: JSON.stringify({ listId }),
            })
          : Promise.resolve(),
        accountId
          ? rpc(`/accounts/${accountId}/contacts`, {
              method: "POST",
              body: JSON.stringify({
                contactId: contact.id,
                isPrimary: true,
              }),
            })
          : Promise.resolve(),
      ]);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pr-1"
    >
      <div className="grid grid-cols-2 gap-3">
        <InputField label="名" name="firstName" />
        <InputField label="姓" name="lastName" />
      </div>
      <InputField label="メールアドレス" name="email" type="email" />
      <div className="grid grid-cols-2 gap-3">
        <InputField label="電話番号" name="phone" />
        <InputField label="外部ID" name="externalId" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <InputField label="ステージ" name="stage" defaultValue="lead" />
        <SelectInput label="アカウント" name="accountId">
          <NativeSelectOption value="">指定なし</NativeSelectOption>
          {options.accounts.map((account) => (
            <NativeSelectOption key={account.id} value={account.id}>
              {account.name}
            </NativeSelectOption>
          ))}
        </SelectInput>
        <SelectInput label="タグ" name="tagId">
          <NativeSelectOption value="">指定なし</NativeSelectOption>
          {options.tags.map((tag) => (
            <NativeSelectOption key={tag.id} value={tag.id}>
              {tag.name}
            </NativeSelectOption>
          ))}
        </SelectInput>
        <SelectInput label="リスト" name="listId">
          <NativeSelectOption value="">指定なし</NativeSelectOption>
          {options.lists.map((list) => (
            <NativeSelectOption key={list.id} value={list.id}>
              {list.name}
            </NativeSelectOption>
          ))}
        </SelectInput>
      </div>
      <p className="text-xs text-muted-foreground">
        メールアドレスまたは外部IDのどちらかを入力してください。
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <LoadingButton busy={busy} busyLabel="保存中…" className="w-full" type="submit">
        保存
      </LoadingButton>
    </form>
  );
}

function SegmentSaveForm({
  filter,
  onSaved,
}: {
  filter: SegmentFilter | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filter) return;
    const name = getFormString(new FormData(event.currentTarget), "name");
    setBusy(true);
    try {
      await rpc("/segments", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug: slugify(name),
          kind: "dynamic",
          filter,
        }),
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "セグメントを保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <InputField label="セグメント名" name="name" required />
      <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        現在の検索条件を動的セグメントとして保存します。連絡先の状態が変わったら再評価できます。
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <LoadingButton busy={busy} className="w-full" type="submit" disabled={!filter}>
        保存
      </LoadingButton>
    </form>
  );
}

function ContactDrawer({
  contactId,
  options,
  onClose,
  onChanged,
}: {
  contactId: string;
  options: ContactOptions;
  onClose: () => void;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await rpc<ContactProfile>(`/contacts/${contactId}/profile`);
      setProfile(response.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "プロフィールを読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function changed() {
    await Promise.all([loadProfile(), onChanged()]);
  }

  async function mutate(path: string, init: RequestInit) {
    setError("");
    try {
      await rpc(path, init);
      await changed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新できませんでした");
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="!w-full overflow-y-auto p-0 sm:!max-w-2xl">
        {loading && !profile ? (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-14 w-64" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : profile ? (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "details" | "activity")}
            className="gap-0"
          >
            <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start gap-4">
                <ContactAvatar contact={profile.contact} large />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-xl">
                      {contactName(profile.contact)}
                    </SheetTitle>
                    <StatusBadge status={profile.contact.status} />
                  </div>
                  <SheetDescription>
                    {profile.contact.email ?? profile.contact.phone ?? "連絡先情報なし"}
                  </SheetDescription>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <TabsList>
                  <TabsTrigger value="details">プロフィール</TabsTrigger>
                  <TabsTrigger value="activity">アクティビティ</TabsTrigger>
                </TabsList>
                {profile.contact.status === "archived" ? (
                  <Button
                    variant="outline"
                    className="ml-auto"
                    onClick={() =>
                      void mutate(`/contacts/${contactId}/restore`, {
                        method: "POST",
                      })
                    }
                  >
                    <RotateCcw data-icon="inline-start" />
                    復元
                  </Button>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button variant="destructive" className="ml-auto" />}
                    >
                      <Archive data-icon="inline-start" />
                      アーカイブ
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogMedia>
                          <Archive />
                        </AlertDialogMedia>
                        <AlertDialogTitle>連絡先をアーカイブしますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          配信対象から外れます。必要になった場合は後から復元できます。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() =>
                            void mutate(`/contacts/${contactId}`, {
                              method: "DELETE",
                            })
                          }
                        >
                          アーカイブ
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </SheetHeader>

            <TabsContent value="details" className="flex flex-col gap-5 p-6">
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="スコア" value={profile.contact.score} icon={<Zap />} />
                <StatCard label="タグ" value={profile.tags.length} icon={<Tag />} />
                <StatCard label="リスト" value={profile.lists.length} icon={<ListPlus />} />
                <StatCard label="会社" value={profile.accounts.length} icon={<Building2 />} />
              </div>

              <ProfileEditForm
                profile={profile}
                disabled={profile.contact.status === "archived"}
                onSaved={changed}
              />

              <RelationEditor
                title="タグ"
                icon={<Tags className="size-4" />}
                items={profile.tags}
                options={options.tags}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) =>
                  mutate(`/contacts/${contactId}/tags`, {
                    method: "POST",
                    body: JSON.stringify({ tagId: id }),
                  })
                }
                onRemove={(id) =>
                  mutate(`/contacts/${contactId}/tags/${id}`, {
                    method: "DELETE",
                  })
                }
              />

              <RelationEditor
                title="リスト"
                icon={<ListPlus className="size-4" />}
                items={profile.lists}
                options={options.lists}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) =>
                  mutate(`/contacts/${contactId}/lists`, {
                    method: "POST",
                    body: JSON.stringify({ listId: id }),
                  })
                }
                onRemove={(id) =>
                  mutate(`/contacts/${contactId}/lists/${id}`, {
                    method: "DELETE",
                  })
                }
              />

              <AccountEditor
                contactId={contactId}
                accounts={profile.accounts}
                options={options.accounts}
                disabled={profile.contact.status === "archived"}
                onChanged={changed}
              />

              <SegmentEditor
                profile={profile}
                options={options.segments}
                disabled={profile.contact.status === "archived"}
                onAdd={(id) =>
                  mutate(`/contacts/${contactId}/segments`, {
                    method: "POST",
                    body: JSON.stringify({ segmentId: id }),
                  })
                }
                onRemove={(id) =>
                  mutate(`/contacts/${contactId}/segments/${id}`, {
                    method: "DELETE",
                  })
                }
              />

              <ScoreForm
                contactId={contactId}
                disabled={profile.contact.status === "archived"}
                onSaved={changed}
              />
            </TabsContent>
            <TabsContent value="activity" className="p-6">
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <ActivityTimeline profile={profile} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="p-6">
            <ErrorNotice>{error}</ErrorNotice>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProfileEditForm({
  profile,
  disabled,
  onSaved,
}: {
  profile: ContactProfile;
  disabled: boolean;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contact = profile.contact;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await rpc(`/contacts/${contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: optionalString(form.get("firstName")) ?? null,
          lastName: optionalString(form.get("lastName")) ?? null,
          email: optionalString(form.get("email")) ?? null,
          phone: optionalString(form.get("phone")) ?? null,
          externalId: optionalString(form.get("externalId")) ?? null,
          stage: form.get("stage"),
        }),
      });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="基本情報" icon={<UserRound className="size-4" />}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="名"
            name="firstName"
            defaultValue={contact.firstName ?? ""}
            disabled={disabled}
          />
          <InputField
            label="姓"
            name="lastName"
            defaultValue={contact.lastName ?? ""}
            disabled={disabled}
          />
        </div>
        <InputField
          label="メール"
          name="email"
          type="email"
          defaultValue={contact.email ?? ""}
          disabled={disabled}
        />
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="電話番号"
            name="phone"
            defaultValue={contact.phone ?? ""}
            disabled={disabled}
          />
          <InputField
            label="外部ID"
            name="externalId"
            defaultValue={contact.externalId ?? ""}
            disabled={disabled}
          />
        </div>
        <InputField
          label="ステージ"
          name="stage"
          defaultValue={contact.stage}
          disabled={disabled}
          required
        />
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!disabled && (
          <LoadingButton busy={busy} variant="outline" type="submit">
            <Check data-icon="inline-start" />
            基本情報を保存
          </LoadingButton>
        )}
      </form>
    </Section>
  );
}

function RelationEditor({
  title,
  icon,
  items,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ id: string; name: string; color: string }>;
  options: Array<{ id: string; name: string; color: string }>;
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(items.map((item) => item.id));
  return (
    <Section title={title} icon={icon}>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item.id} variant="outline" className="gap-1">
            <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
            {!disabled && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void onRemove(item.id)}
                aria-label={`${item.name}を削除`}
              >
                <X />
              </Button>
            )}
          </Badge>
        ))}
        {items.length === 0 && <span className="text-sm text-muted-foreground">未設定</span>}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder={`追加する${title}を選択`}
            className="flex-1"
            options={options
              .filter((item) => !assigned.has(item.id))
              .map((item) => ({ value: item.id, label: item.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then(() => setSelectedId(""));
            }}
          >
            追加
          </Button>
        </div>
      )}
    </Section>
  );
}

function AccountEditor({
  contactId,
  accounts,
  options,
  disabled,
  onChanged,
}: {
  contactId: string;
  accounts: ContactProfile["accounts"];
  options: AccountOption[];
  disabled: boolean;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assigned = new Set(accounts.map((account) => account.id));

  async function addAccount() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await rpc(`/accounts/${selectedId}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          contactId,
          isPrimary: accounts.length === 0,
        }),
      });
      setSelectedId("");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "アカウントへ追加できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(accountId: string) {
    setBusy(true);
    setError("");
    try {
      await rpc(`/accounts/${accountId}/contacts/${contactId}`, {
        method: "DELETE",
      });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "アカウントとの関連を解除できませんでした",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="アカウント" icon={<Building2 />}>
      <div className="flex flex-wrap gap-2">
        {accounts.map((account) => (
          <Badge key={account.id} variant="outline">
            <Building2 />
            {account.name}
            {account.is_primary ? " · 主担当" : ""}
            {!disabled ? (
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                onClick={() => void removeAccount(account.id)}
                aria-label={`${account.name}との関連を解除`}
              >
                <X />
              </Button>
            ) : null}
          </Badge>
        ))}
        {accounts.length === 0 ? (
          <span className="text-sm text-muted-foreground">未所属</span>
        ) : null}
      </div>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {!disabled ? (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="追加するアカウントを選択"
            className="flex-1"
            options={options
              .filter((account) => !assigned.has(account.id))
              .map((account) => ({
                value: account.id,
                label: account.name,
              }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId || busy}
            onClick={() => void addAccount()}
          >
            追加
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function SegmentEditor({
  profile,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  profile: ContactProfile;
  options: SegmentOption[];
  disabled: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}): ReactNode {
  const [selectedId, setSelectedId] = useState("");
  const assigned = new Set(profile.segments.map((segment) => segment.id));
  return (
    <Section title="セグメント" icon={<Filter className="size-4" />}>
      <div className="flex flex-col gap-2">
        {profile.segments.map((segment) => (
          <div
            key={segment.id}
            className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
          >
            <span>{segment.name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{segment.kind}</Badge>
              {!disabled && segment.source === "static" && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void onRemove(segment.id)}
                  aria-label={`${segment.name}から削除`}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>
        ))}
        {profile.segments.length === 0 && (
          <span className="text-sm text-muted-foreground">未所属</span>
        )}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <ControlledSelect
            value={selectedId}
            onValueChange={setSelectedId}
            placeholder="静的セグメントを選択"
            className="flex-1"
            options={options
              .filter((segment) => segment.kind === "static" && !assigned.has(segment.id))
              .map((segment) => ({ value: segment.id, label: segment.name }))}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              void onAdd(selectedId).then(() => setSelectedId(""));
            }}
          >
            追加
          </Button>
        </div>
      )}
    </Section>
  );
}

function ScoreForm({
  contactId,
  disabled,
  onSaved,
}: {
  contactId: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (disabled) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    try {
      await rpc(`/contacts/${contactId}/score`, {
        method: "POST",
        body: JSON.stringify({
          delta: Number(form.get("delta")),
          reason: form.get("reason"),
        }),
      });
      formElement.reset();
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "スコアを変更できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="スコアを調整" icon={<Zap className="size-4" />}>
      <form
        onSubmit={(event) => void submit(event)}
        className="grid gap-3 md:grid-cols-[120px_1fr_auto]"
      >
        <InputField label="加減点" name="delta" type="number" required />
        <InputField label="理由" name="reason" required />
        <div className="flex items-end">
          <LoadingButton busy={busy} variant="outline" type="submit">
            反映
          </LoadingButton>
        </div>
        {error && (
          <div className="md:col-span-3">
            <ErrorNotice>{error}</ErrorNotice>
          </div>
        )}
      </form>
    </Section>
  );
}

function ActivityTimeline({ profile }: { profile: ContactProfile }): ReactNode {
  const entries = useMemo(
    () =>
      [
        ...profile.timeline.map((event) => ({
          id: event.id,
          type: event.type,
          description: event.resource_type
            ? `${event.resource_type}${event.resource_id ? ` · ${event.resource_id}` : ""}`
            : "Contact activity",
          at: event.occurred_at,
          tone: "indigo",
        })),
        ...profile.scoreEvents.map((event) => ({
          id: event.id,
          type: event.delta > 0 ? `スコア +${event.delta}` : `スコア ${event.delta}`,
          description: `${event.reason} · 合計 ${event.total}`,
          at: event.created_at,
          tone: event.delta > 0 ? "emerald" : "amber",
        })),
      ].sort((left, right) => right.at.localeCompare(left.at)),
    [profile.scoreEvents, profile.timeline],
  );
  return (
    <Section title="アクティビティ" icon={<Zap className="size-4" />}>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <div key={`${entry.type}-${entry.id}`} className="flex gap-3 border-b py-3 last:border-0">
            <span
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                entry.tone === "emerald"
                  ? "bg-success"
                  : entry.tone === "amber"
                    ? "bg-warning"
                    : "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{entry.type}</div>
              <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
            </div>
            <time className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.at)}</time>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            まだアクティビティがありません
          </div>
        )}
      </div>
    </Section>
  );
}

function ContactAvatar({
  contact,
  large = false,
}: {
  contact: Contact;
  large?: boolean;
}): ReactNode {
  const initials = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .map((value) => value!.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Avatar size={large ? "lg" : "default"} className={cn(large && "size-14")}>
      <AvatarFallback className={cn(large && "text-lg")}>
        {initials || <UserRound />}
      </AvatarFallback>
    </Avatar>
  );
}

function StatusBadge({ status }: { status: Contact["status"] }): ReactNode {
  const classes = (
    {
      active: "bg-success text-success-foreground",
      archived: "",
      anonymous: "bg-warning text-warning-foreground",
    } satisfies Record<Contact["status"], string>
  )[status];
  const label = { active: "有効", archived: "アーカイブ", anonymous: "匿名" }[status];
  return (
    <Badge variant="secondary" className={classes}>
      {label}
    </Badge>
  );
}

function ColorChip({ item }: { item: { name: string; color: string } }): ReactNode {
  return (
    <Badge variant="secondary" className="gap-1">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
      {item.name}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}): ReactNode {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}): ReactNode {
  return (
    <SelectInput
      label={label}
      name={`filter-${label}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </SelectInput>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}): ReactNode {
  return (
    <InputField
      label={label}
      name={`filter-${label}`}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function contactName(contact: Contact): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    contact.externalId ||
    "匿名Contact"
  );
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 100) || `segment-${Date.now()}`
  );
}

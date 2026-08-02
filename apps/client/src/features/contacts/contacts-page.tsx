import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, ChevronDown, Filter, Plus, RefreshCw, Search, Tags, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { AppDialog, ErrorAlert as ErrorNotice, PageLayout as Page } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { NativeSelectOption } from "@/components/ui/native-select";
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
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { ContactSummary } from "@kaenma/orpc";

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
import { createSegmentFilter } from "./segment-filter";

export function ContactsPage({ initialSearch }: { initialSearch: ContactSearch }): ReactNode {
  const queryClient = useQueryClient();
  // Local, not URL-synced: cursor pagination resets whenever the URL-backed
  // filters change (below), same trigger the query itself refetches on.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  useEffect(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, [initialSearch]);

  const contactsQuery = useQuery(contactsQueryOptions(initialSearch, cursor));
  const optionsQuery = useSuspenseQuery(contactOptionsQueryOptions());
  const contacts = contactsQuery.data?.items ?? [];
  const options = optionsQuery.data;
  const total = contactsQuery.data?.total ?? 0;
  const nextCursor = contactsQuery.data?.nextCursor;
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
    companyId,
    setCompanyId,
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

  function goToNextPage() {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor ?? ""]);
    setCursor(nextCursor);
    setSelected(new Set());
  }

  function goToPreviousPage() {
    setCursorHistory((history) => {
      if (history.length === 0) return history;
      const previous = history[history.length - 1];
      setCursor(previous || undefined);
      return history.slice(0, -1);
    });
    setSelected(new Set());
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
      await orpc.contactResources.bulkAction({
        contactIds: [...selected],
        action: bulkAction,
        ...(needsResource ? { resourceId: bulkResourceId } : {}),
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
      await orpc.segments.refresh({ id: segmentId });
      await refreshContactData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "セグメントを更新できませんでした");
    } finally {
      setBusy(false);
    }
  }

  function buildSegmentFilter() {
    return createSegmentFilter(
      { q: query, status, stage, tagId, companyId, scoreMin, scoreMax },
      options,
    );
  }

  const columns: DataTableColumn<ContactSummary>[] = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={allVisibleSelected}
          onCheckedChange={(checked) =>
            setSelected(checked ? new Set(contacts.map((contact) => contact.id)) : new Set())
          }
          aria-label="表示中の連絡先をすべて選択"
        />
      ),
      cell: (contact) => (
        <Checkbox
          checked={selected.has(contact.id)}
          onCheckedChange={(checked) => {
            const next = new Set(selected);
            if (checked) next.add(contact.id);
            else next.delete(contact.id);
            setSelected(next);
          }}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${contactName(contact)}を選択`}
        />
      ),
      headClassName: "w-12 px-5",
      cellClassName: "px-5",
    },
    {
      key: "contact",
      header: "連絡先",
      cell: (contact) => (
        <div className="flex items-center gap-3">
          <ContactAvatar contact={contact} />
          <div className="min-w-0">
            <div className="truncate font-medium">{contactName(contact)}</div>
            <div className="truncate text-xs text-muted-foreground">
              {contact.email ?? contact.phone ?? contact.externalId ?? "匿名Contact"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "状態",
      cell: (contact) => (
        <div className="flex flex-wrap gap-1.5">
          <ContactStatusBadge status={contact.status} />
          <Badge variant="outline">{contact.stage}</Badge>
        </div>
      ),
    },
    {
      key: "classification",
      header: "会社・分類",
      cell: (contact) => (
        <div className="flex flex-wrap gap-1">
          {contact.companies.slice(0, 1).map((company) => (
            <Badge key={company.id} variant="secondary">
              <Building2 />
              {company.name}
            </Badge>
          ))}
          {contact.tags.slice(0, 3).map((tag) => (
            <ColorChip key={tag.id} item={tag} />
          ))}
          {contact.companies.length + contact.tags.length === 0 && (
            <span className="text-xs text-muted-foreground">未分類</span>
          )}
        </div>
      ),
      cellClassName: "max-w-80",
    },
    {
      key: "score",
      header: "スコア",
      cell: (contact) => (
        <Badge
          variant="secondary"
          className={cn(
            "min-w-12 justify-center tabular-nums",
            contact.score >= 50 && "bg-success text-success-foreground",
            contact.score >= 20 && contact.score < 50 && "bg-warning text-warning-foreground",
          )}
        >
          {contact.score}
        </Badge>
      ),
      headClassName: "text-right",
      cellClassName: "text-right",
    },
    {
      key: "updatedAt",
      header: "更新日",
      cell: (contact) => formatLongDateTime(contact.updatedAt),
      headClassName: "px-5 text-right",
      cellClassName: "px-5 text-right text-xs text-muted-foreground",
    },
  ];

  return (
    <Page
      title="連絡先"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/companies" />}>
            <Building2 data-icon="inline-start" />
            会社
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/contacts/tags" />}>
            <Tags data-icon="inline-start" />
            タグ
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
              value={companyId}
              onValueChange={setCompanyId}
              placeholder="すべての会社"
              className="min-w-44"
              options={options.companies.map((company) => ({
                value: company.id,
                label: company.name,
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
                    {item.stage} ({item.contactCount})
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
                { value: "add_segment", label: "セグメントへ追加" },
                { value: "remove_segment", label: "セグメントから削除" },
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
            {bulkAction.includes("segment") && (
              <ControlledSelect
                value={bulkResourceId}
                onValueChange={setBulkResourceId}
                placeholder="セグメントを選択"
                options={options.segments
                  .filter((segment) => segment.kind === "static")
                  .map((segment) => ({
                    value: segment.id,
                    label: segment.name,
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
          <DataTable
            columns={columns}
            rows={contacts}
            rowKey={(contact) => contact.id}
            caption="連絡先一覧"
            loading={loading}
            emptyTitle="条件に一致する連絡先がありません"
            emptyDescription="検索条件を変更するか、新しい連絡先を追加してください。"
            onRowClick={(contact) => setActiveContactId(contact.id)}
            className="min-w-[980px]"
            pagination={{
              hasNextPage: Boolean(nextCursor),
              hasPreviousPage: cursorHistory.length > 0,
              onNext: goToNextPage,
              onPrevious: goToPreviousPage,
            }}
          />
        </CardContent>
      </Card>

      <AppDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        title="連絡先を追加"
        description="プロフィール、会社、タグ、セグメントを登録します。"
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

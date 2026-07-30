import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CircleDollarSign,
  CircleX,
  Clock3,
  Mail,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  archiveDeal,
  createDeal,
  createDealTask,
  deleteDealTask,
  moveDeal,
  updateDeal,
  updateDealTask,
  type DealCreate,
  type DealDetailData,
  type DealListData,
  type DealOptions,
  type DealPipeline,
  type DealSearch,
  type DealStatus,
  type DealSummary,
  type DealTask,
  type DealTaskCreate,
  type DealTaskType,
} from "@/features/deals/deal-api";
import { formatDate, formatMoney, formatMonthDayTime, toDateTimeLocal } from "@/lib/format";
import { getFormString } from "@/lib/utils";

export function DealsPage({
  initialData,
  search,
}: {
  initialData: { deals: DealListData; options: DealOptions };
  search: DealSearch;
}): ReactNode {
  const navigate = useNavigate();
  const router = useRouter();
  const [query, setQuery] = useState(search.q);
  const [showCreate, setShowCreate] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const options = initialData.options;
  const activePipeline =
    options.pipelines.find((pipeline) => pipeline.id === search.pipelineId) ??
    options.pipelines.find((pipeline) => pipeline.isDefault) ??
    options.pipelines[0];

  useEffect(() => {
    setQuery(search.q);
  }, [search.q]);

  useEffect(() => {
    if (query === search.q) return;
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/deals",
        search: { ...search, q: query },
        replace: true,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [navigate, query, search]);

  async function move(dealId: string, stageId: string): Promise<void> {
    setMovingId(dealId);
    try {
      await moveDeal(dealId, stageId);
      await router.invalidate({ sync: true });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "ステージを変更できませんでした");
    } finally {
      setMovingId(null);
    }
  }

  return (
    <PageLayout
      title="Deals"
      action={
        <Button onClick={() => setShowCreate(true)} disabled={!activePipeline}>
          <Plus data-icon="inline-start" />
          商談を作成
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="進行中の商談"
          value={`${initialData.deals.summary.openCount.toLocaleString()}件`}
          detail={formatMoney(initialData.deals.summary.openValue, "JPY")}
          icon={<BriefcaseBusiness />}
        />
        <MetricCard
          label="獲得済み"
          value={`${initialData.deals.summary.wonCount.toLocaleString()}件`}
          detail={formatMoney(initialData.deals.summary.wonValue, "JPY")}
          icon={<CircleDollarSign />}
        />
        <MetricCard
          label="失注"
          value={`${initialData.deals.summary.lostCount.toLocaleString()}件`}
          detail="パイプライン累計"
          icon={<CircleX />}
        />
        <MetricCard
          label="パイプライン"
          value={activePipeline?.name ?? "未設定"}
          detail={`${activePipeline?.stages.length ?? 0}ステージ`}
          icon={<UsersRound />}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <FormNativeSelect
              label="パイプライン"
              name="pipeline"
              value={activePipeline?.id ?? ""}
              onChange={(event) =>
                void navigate({
                  to: "/deals",
                  search: { ...search, pipelineId: event.target.value },
                })
              }
            >
              {options.pipelines.map((pipeline) => (
                <FormSelectOption key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </FormSelectOption>
              ))}
            </FormNativeSelect>
          </div>
          <div className="min-w-40">
            <FormNativeSelect
              label="ステータス"
              name="status"
              value={search.status}
              onChange={(event) =>
                void navigate({
                  to: "/deals",
                  search: {
                    ...search,
                    status: event.target.value as DealSearch["status"],
                  },
                })
              }
            >
              <FormSelectOption value="open">進行中</FormSelectOption>
              <FormSelectOption value="won">獲得</FormSelectOption>
              <FormSelectOption value="lost">失注</FormSelectOption>
              <FormSelectOption value="all">すべて</FormSelectOption>
            </FormNativeSelect>
          </div>
          <div className="min-w-64 flex-[2]">
            <label className="mb-2 block text-sm font-medium" htmlFor="deal-search">
              検索
            </label>
            <InputGroup>
              <InputGroupInput
                id="deal-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="商談、連絡先、会社名で検索"
              />
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
            </InputGroup>
          </div>
        </CardContent>
      </Card>

      {activePipeline ? (
        <DealBoard
          pipeline={activePipeline}
          deals={initialData.deals.items}
          movingId={movingId}
          onMove={move}
          onCreate={() => setShowCreate(true)}
        />
      ) : (
        <EmptyState
          title="パイプラインがありません"
          description="ワークスペースのDeals設定を確認してください。"
        />
      )}

      {activePipeline ? (
        <AppDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          title="商談を作成"
          description="金額、ステージ、関連する顧客を登録します。"
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        >
          <DealForm
            options={options}
            initialPipelineId={activePipeline.id}
            submitLabel="商談を作成"
            onSubmit={async (values) => {
              const deal = await createDeal(values);
              toast.success("商談を作成しました");
              setShowCreate(false);
              await navigate({ to: "/deals/$id", params: { id: deal.id } });
            }}
          />
        </AppDialog>
      ) : null}
    </PageLayout>
  );
}

function DealBoard({
  pipeline,
  deals,
  movingId,
  onMove,
  onCreate,
}: {
  pipeline: DealPipeline;
  deals: DealSummary[];
  movingId: string | null;
  onMove: (dealId: string, stageId: string) => Promise<void>;
  onCreate: () => void;
}): ReactNode {
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto pb-3">
      <div className="grid min-w-max auto-cols-[minmax(280px,1fr)] grid-flow-col gap-4">
        {pipeline.stages.map((stage, index) => {
          const stageDeals = deals.filter((deal) => deal.stageId === stage.id);
          const total = stageDeals.reduce((sum, deal) => sum + deal.value, 0);
          return (
            <section
              key={stage.id}
              className="w-[300px] rounded-xl bg-muted/50 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedDealId) return;
                const deal = deals.find((item) => item.id === draggedDealId);
                if (deal && deal.stageId !== stage.id) void onMove(deal.id, stage.id);
                setDraggedDealId(null);
              }}
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: stage.color }}
                      aria-hidden
                    />
                    <h2 className="font-heading font-medium">{stage.name}</h2>
                    <Badge variant="secondary">{stageDeals.length}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMoney(total, stageDeals[0]?.currency ?? "JPY")} · 成約確度
                    {stage.probability}%
                  </p>
                </div>
              </header>
              <div className="flex flex-col gap-3">
                {stageDeals.map((deal) => (
                  <Card
                    key={deal.id}
                    size="sm"
                    className={`bg-card ${draggedDealId === deal.id ? "opacity-50" : ""}`}
                    draggable={movingId !== deal.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", deal.id);
                      setDraggedDealId(deal.id);
                    }}
                    onDragEnd={() => setDraggedDealId(null)}
                  >
                    <CardHeader>
                      <CardTitle>
                        <Link to="/deals/$id" params={{ id: deal.id }} className="hover:underline">
                          {deal.name}
                        </Link>
                      </CardTitle>
                      <CardDescription>{formatMoney(deal.value, deal.currency)}</CardDescription>
                      <CardAction>
                        <DealStatusBadge status={deal.status} />
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
                      {deal.accountName ? (
                        <span className="flex items-center gap-1.5">
                          <UsersRound className="size-3.5" />
                          {deal.accountName}
                        </span>
                      ) : null}
                      {deal.ownerName ? (
                        <span className="flex items-center gap-1.5">
                          <UserRound className="size-3.5" />
                          {deal.ownerName}
                        </span>
                      ) : null}
                      {deal.nextTaskAt ? (
                        <span className="flex items-center gap-1.5">
                          <Clock3 className="size-3.5" />
                          次のタスク {formatMonthDayTime(deal.nextTaskAt)}
                        </span>
                      ) : deal.openTaskCount > 0 ? (
                        <span>{deal.openTaskCount}件の未完了タスク</span>
                      ) : null}
                    </CardContent>
                    <div className="flex justify-between border-t px-3 pt-3">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="前のステージへ移動"
                        disabled={index === 0 || movingId === deal.id}
                        onClick={() => {
                          const previous = pipeline.stages[index - 1];
                          if (previous) void onMove(deal.id, previous.id);
                        }}
                      >
                        <ArrowLeft />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="次のステージへ移動"
                        disabled={index === pipeline.stages.length - 1 || movingId === deal.id}
                        onClick={() => {
                          const next = pipeline.stages[index + 1];
                          if (next) void onMove(deal.id, next.id);
                        }}
                      >
                        <ArrowRight />
                      </Button>
                    </div>
                  </Card>
                ))}
                {stageDeals.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                    このステージに商談はありません
                  </div>
                ) : null}
                {index === 0 ? (
                  <Button variant="ghost" size="sm" className="w-full" onClick={onCreate}>
                    <Plus data-icon="inline-start" />
                    商談を追加
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function DealDetailPage({
  dealId,
  initialData,
}: {
  dealId: string;
  initialData: { detail: DealDetailData; options: DealOptions };
}): ReactNode {
  const router = useRouter();
  const navigate = useNavigate();
  const [showEdit, setShowEdit] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { deal, tasks } = initialData.detail;

  async function refresh(): Promise<void> {
    await router.invalidate({ sync: true });
  }

  async function changeStatus(status: DealStatus): Promise<void> {
    setBusyAction(status);
    try {
      await updateDeal(deal.id, { status });
      toast.success(
        status === "won"
          ? "商談を獲得にしました"
          : status === "lost"
            ? "商談を失注にしました"
            : "商談を再開しました",
      );
      await refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "ステータスを変更できませんでした");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeTask(task: DealTask): Promise<void> {
    if (!window.confirm(`「${task.title}」を削除しますか？`)) return;
    try {
      await deleteDealTask(deal.id, task.id);
      toast.success("タスクを削除しました");
      await refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "タスクを削除できませんでした");
    }
  }

  return (
    <PageLayout
      title={deal.name}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/deals" />}>
            <ArrowLeft data-icon="inline-start" />
            一覧
          </Button>
          <Button variant="outline" onClick={() => setShowEdit(true)}>
            <Pencil data-icon="inline-start" />
            編集
          </Button>
          {deal.status === "open" ? (
            <>
              <LoadingButton
                busy={busyAction === "won"}
                variant="outline"
                onClick={() => void changeStatus("won")}
              >
                <Check data-icon="inline-start" />
                獲得
              </LoadingButton>
              <LoadingButton
                busy={busyAction === "lost"}
                variant="outline"
                onClick={() => void changeStatus("lost")}
              >
                <CircleX data-icon="inline-start" />
                失注
              </LoadingButton>
            </>
          ) : (
            <LoadingButton
              busy={busyAction === "open"}
              variant="outline"
              onClick={() => void changeStatus("open")}
            >
              <RotateCcw data-icon="inline-start" />
              再開
            </LoadingButton>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <DealStatusBadge status={deal.status} />
        <Badge variant="outline">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: deal.stageColor }}
            aria-hidden
          />
          {deal.pipelineName} / {deal.stageName}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="商談金額"
          value={formatMoney(deal.value, deal.currency)}
          detail={`成約確度 ${deal.stageProbability}%`}
          icon={<CircleDollarSign />}
        />
        <MetricCard
          label="完了予定日"
          value={deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "未設定"}
          detail={deal.status === "open" ? "進行中" : statusLabel(deal.status)}
          icon={<CalendarClock />}
        />
        <MetricCard
          label="担当者"
          value={deal.ownerName ?? "未設定"}
          detail={deal.ownerEmail ?? "担当者を設定してください"}
          icon={<UserRound />}
        />
        <MetricCard
          label="未完了タスク"
          value={`${deal.openTaskCount.toLocaleString()}件`}
          detail={deal.nextTaskAt ? `次回 ${formatMonthDayTime(deal.nextTaskAt)}` : "予定なし"}
          icon={<Clock3 />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>タスク</CardTitle>
            <CardDescription>商談に紐づく次のアクションを管理します。</CardDescription>
            <CardAction>
              <Button onClick={() => setShowTask(true)}>
                <Plus data-icon="inline-start" />
                タスクを追加
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onEdit={() => setEditingTask(task)}
                onToggle={async () => {
                  try {
                    await updateDealTask(deal.id, task.id, {
                      status: task.status === "open" ? "completed" : "open",
                    });
                    await refresh();
                  } catch (caught) {
                    toast.error(
                      caught instanceof Error ? caught.message : "タスクを更新できませんでした",
                    );
                  }
                }}
                onDelete={() => void removeTask(task)}
              />
            ))}
            {tasks.length === 0 ? (
              <EmptyState
                compact
                title="タスクはまだありません"
                description="電話、メール、ミーティングなど次のアクションを登録しましょう。"
                action={
                  <Button variant="outline" onClick={() => setShowTask(true)}>
                    <Plus data-icon="inline-start" />
                    最初のタスクを追加
                  </Button>
                }
              />
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>関連先</CardTitle>
              <CardDescription>この商談に紐づく顧客情報</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <DetailItem
                label="連絡先"
                value={contactLabel(deal) || "未設定"}
                detail={deal.contactEmail}
              />
              <DetailItem label="アカウント" value={deal.accountName ?? "未設定"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>メモ</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {deal.description || "商談の説明はまだありません。"}
              </p>
            </CardContent>
          </Card>
          <Button
            variant="destructive"
            className="self-start"
            onClick={() => {
              if (!window.confirm(`「${deal.name}」をアーカイブしますか？`)) return;
              void archiveDeal(deal.id)
                .then(async () => {
                  toast.success("商談をアーカイブしました");
                  await navigate({ to: "/deals" });
                })
                .catch((caught: unknown) => {
                  toast.error(
                    caught instanceof Error ? caught.message : "商談をアーカイブできませんでした",
                  );
                });
            }}
          >
            <Archive data-icon="inline-start" />
            アーカイブ
          </Button>
        </div>
      </div>

      <AppDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        title="商談を編集"
        description="商談情報と関連先を更新します。"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DealForm
          options={initialData.options}
          deal={deal}
          submitLabel="変更を保存"
          onSubmit={async (values) => {
            await updateDeal(deal.id, values);
            toast.success("商談を更新しました");
            setShowEdit(false);
            await refresh();
          }}
        />
      </AppDialog>

      <AppDialog
        open={showTask}
        onOpenChange={setShowTask}
        title="タスクを追加"
        description="商談に対する次のアクションを登録します。"
      >
        <DealTaskForm
          members={initialData.options.members}
          submitLabel="タスクを追加"
          onSubmit={async (values) => {
            await createDealTask(dealId, values);
            toast.success("タスクを追加しました");
            setShowTask(false);
            await refresh();
          }}
        />
      </AppDialog>

      <AppDialog
        open={Boolean(editingTask)}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
        title="タスクを編集"
      >
        {editingTask ? (
          <DealTaskForm
            members={initialData.options.members}
            task={editingTask}
            submitLabel="変更を保存"
            onSubmit={async (values) => {
              await updateDealTask(dealId, editingTask.id, values);
              toast.success("タスクを更新しました");
              setEditingTask(null);
              await refresh();
            }}
          />
        ) : null}
      </AppDialog>
    </PageLayout>
  );
}

function DealForm({
  options,
  deal,
  initialPipelineId,
  submitLabel,
  onSubmit,
}: {
  options: DealOptions;
  deal?: DealSummary;
  initialPipelineId?: string;
  submitLabel: string;
  onSubmit: (values: DealCreate) => Promise<void>;
}): ReactNode {
  const firstPipelineId =
    deal?.pipelineId ??
    initialPipelineId ??
    options.pipelines.find((pipeline) => pipeline.isDefault)?.id ??
    options.pipelines[0]?.id ??
    "";
  const [pipelineId, setPipelineId] = useState(firstPipelineId);
  const [stageId, setStageId] = useState(deal?.stageId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stages = useMemo(
    () => options.pipelines.find((pipeline) => pipeline.id === pipelineId)?.stages ?? [],
    [options.pipelines, pipelineId],
  );
  const selectedStageId = stages.some((stage) => stage.id === stageId)
    ? stageId
    : (stages[0]?.id ?? "");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        name: getFormString(form, "name").trim(),
        pipelineId,
        stageId: selectedStageId,
        value: Number(getFormString(form, "value") || "0"),
        currency: getFormString(form, "currency"),
        status: getFormString(form, "status") as DealStatus,
        ownerUserId: getFormString(form, "ownerUserId") || null,
        contactId: getFormString(form, "contactId") || null,
        accountId: getFormString(form, "accountId") || null,
        expectedCloseDate: getFormString(form, "expectedCloseDate") || null,
        description: getFormString(form, "description").trim(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "商談を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="商談名"
          name="name"
          defaultValue={deal?.name ?? ""}
          placeholder="例：Acme社 MA導入"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect
            label="パイプライン"
            name="pipelineId"
            value={pipelineId}
            onChange={(event) => {
              setPipelineId(event.target.value);
              setStageId("");
            }}
            required
          >
            {options.pipelines.map((pipeline) => (
              <FormSelectOption key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          <FormNativeSelect
            label="ステージ"
            name="stageId"
            value={selectedStageId}
            onChange={(event) => setStageId(event.target.value)}
            required
          >
            {stages.map((stage) => (
              <FormSelectOption key={stage.id} value={stage.id}>
                {stage.name}（{stage.probability}%）
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </div>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <FormInput
            label="商談金額"
            name="value"
            type="number"
            min="0"
            step="1"
            defaultValue={deal?.value ?? 0}
            required
          />
          <FormNativeSelect label="通貨" name="currency" defaultValue={deal?.currency ?? "JPY"}>
            <FormSelectOption value="JPY">JPY</FormSelectOption>
            <FormSelectOption value="USD">USD</FormSelectOption>
            <FormSelectOption value="EUR">EUR</FormSelectOption>
          </FormNativeSelect>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect label="ステータス" name="status" defaultValue={deal?.status ?? "open"}>
            <FormSelectOption value="open">進行中</FormSelectOption>
            <FormSelectOption value="won">獲得</FormSelectOption>
            <FormSelectOption value="lost">失注</FormSelectOption>
          </FormNativeSelect>
          <FormInput
            label="完了予定日"
            name="expectedCloseDate"
            type="date"
            defaultValue={deal?.expectedCloseDate ?? ""}
          />
        </div>
        <FormNativeSelect label="担当者" name="ownerUserId" defaultValue={deal?.ownerUserId ?? ""}>
          <FormSelectOption value="">未設定</FormSelectOption>
          {options.members.map((member) => (
            <FormSelectOption key={member.id} value={member.id}>
              {member.name || member.email}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect label="連絡先" name="contactId" defaultValue={deal?.contactId ?? ""}>
            <FormSelectOption value="">未設定</FormSelectOption>
            {options.contacts.map((contact) => (
              <FormSelectOption key={contact.id} value={contact.id}>
                {contactOptionLabel(contact)}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
          <FormNativeSelect
            label="アカウント"
            name="accountId"
            defaultValue={deal?.accountId ?? ""}
          >
            <FormSelectOption value="">未設定</FormSelectOption>
            {options.accounts.map((account) => (
              <FormSelectOption key={account.id} value={account.id}>
                {account.name}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </div>
        <FormTextarea
          label="説明・メモ"
          name="description"
          defaultValue={deal?.description ?? ""}
          rows={4}
          placeholder="商談の背景や次に確認する内容"
        />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="保存中…" type="submit">
          {submitLabel}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function DealTaskForm({
  members,
  task,
  submitLabel,
  onSubmit,
}: {
  members: DealOptions["members"];
  task?: DealTask;
  submitLabel: string;
  onSubmit: (values: DealTaskCreate) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const dueAt = getFormString(form, "dueAt");
      await onSubmit({
        title: getFormString(form, "title").trim(),
        type: getFormString(form, "type") as DealTaskType,
        notes: getFormString(form, "notes").trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        assignedUserId: getFormString(form, "assignedUserId") || null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "タスクを保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        <FormInput
          label="タスク名"
          name="title"
          defaultValue={task?.title ?? ""}
          placeholder="例：導入条件を電話で確認"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormNativeSelect label="種別" name="type" defaultValue={task?.type ?? "task"}>
            <FormSelectOption value="task">タスク</FormSelectOption>
            <FormSelectOption value="call">電話</FormSelectOption>
            <FormSelectOption value="email">メール</FormSelectOption>
            <FormSelectOption value="meeting">ミーティング</FormSelectOption>
          </FormNativeSelect>
          <FormInput
            label="期限"
            name="dueAt"
            type="datetime-local"
            defaultValue={toDateTimeLocal(task?.dueAt)}
          />
        </div>
        <FormNativeSelect
          label="担当者"
          name="assignedUserId"
          defaultValue={task?.assignedUserId ?? ""}
        >
          <FormSelectOption value="">未設定</FormSelectOption>
          {members.map((member) => (
            <FormSelectOption key={member.id} value={member.id}>
              {member.name || member.email}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormTextarea label="メモ" name="notes" defaultValue={task?.notes ?? ""} rows={3} />
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <LoadingButton busy={busy} busyLabel="保存中…" type="submit">
          {submitLabel}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function TaskRow({
  task,
  onEdit,
  onToggle,
  onDelete,
}: {
  task: DealTask;
  onEdit: () => void;
  onToggle: () => Promise<void>;
  onDelete: () => void;
}): ReactNode {
  const overdue = task.status === "open" && task.dueAt && new Date(task.dueAt) < new Date();
  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${
        task.status === "completed" ? "bg-muted/40 opacity-70" : ""
      }`}
    >
      <Button
        variant={task.status === "completed" ? "secondary" : "outline"}
        size="icon-sm"
        aria-label={task.status === "completed" ? "未完了に戻す" : "完了にする"}
        onClick={() => void onToggle()}
      >
        <Check />
      </Button>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${task.status === "completed" ? "line-through" : ""}`}>
            {task.title}
          </span>
          <Badge variant="outline">{taskTypeLabel(task.type)}</Badge>
          {overdue ? <Badge variant="destructive">期限超過</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{task.dueAt ? formatMonthDayTime(task.dueAt) : "期限なし"}</span>
          <span>{task.assigneeName ?? "担当者未設定"}</span>
        </div>
        {task.notes ? (
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{task.notes}</p>
        ) : null}
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="タスクを編集" onClick={onEdit}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="タスクを削除" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="truncate text-xl">{value}</CardTitle>
        <CardAction>
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function DetailItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}): ReactNode {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
      {detail && detail !== value ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function DealStatusBadge({ status }: { status: DealStatus }): ReactNode {
  if (status === "won") return <Badge>獲得</Badge>;
  if (status === "lost") return <Badge variant="destructive">失注</Badge>;
  return <Badge variant="secondary">進行中</Badge>;
}

function statusLabel(status: DealStatus): string {
  return status === "won" ? "獲得" : status === "lost" ? "失注" : "進行中";
}

function taskTypeLabel(type: DealTaskType): ReactNode {
  if (type === "call") {
    return (
      <>
        <Phone data-icon="inline-start" />
        電話
      </>
    );
  }
  if (type === "email") {
    return (
      <>
        <Mail data-icon="inline-start" />
        メール
      </>
    );
  }
  if (type === "meeting") {
    return (
      <>
        <UsersRound data-icon="inline-start" />
        ミーティング
      </>
    );
  }
  return "タスク";
}

function contactOptionLabel(contact: DealOptions["contacts"][number]): string {
  const name = [contact.last_name, contact.first_name].filter(Boolean).join(" ");
  return name
    ? `${name}${contact.email ? `（${contact.email}）` : ""}`
    : (contact.email ?? "名前未設定");
}

function contactLabel(deal: DealSummary): string {
  return [deal.contactLastName, deal.contactFirstName].filter(Boolean).join(" ");
}

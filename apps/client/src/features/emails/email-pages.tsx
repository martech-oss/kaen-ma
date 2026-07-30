import {
  Archive,
  CalendarClock,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadEmailArchive,
  loadEmailCampaigns,
  loadEmailTemplates,
  loadEmailVariables,
  type EmailArchiveData,
  type EmailCampaignRow,
  type EmailCampaignsData,
  type EmailTemplateRow,
  type EmailTemplatesData,
  type EmailVariablesData,
  type MessageVariableRow,
  type SegmentOption,
  type TopicOption,
} from "@/features/emails/email-api";
import { nullableString } from "@/lib/form-data";
import { formatDateTime, toDateTimeLocal } from "@/lib/format";
import { getFormString } from "@/lib/utils";
import { rpc } from "@/rpc";

type EmailSection = "campaigns" | "templates" | "variables" | "archive";

export function EmailCampaignsPage({ data }: { data: EmailCampaignsData }): ReactNode {
  return <EmailCenterPage view="campaigns" data={data} />;
}

export function EmailTemplatesPage({ data }: { data: EmailTemplatesData }): ReactNode {
  return <EmailCenterPage view="templates" data={data} />;
}

export function EmailVariablesPage({ data }: { data: EmailVariablesData }): ReactNode {
  return <EmailCenterPage view="variables" data={data} />;
}

export function EmailArchivePage({ data }: { data: EmailArchiveData }): ReactNode {
  return <EmailCenterPage view="archive" data={data} />;
}

type EmailPageData =
  | EmailCampaignsData
  | EmailTemplatesData
  | EmailVariablesData
  | EmailArchiveData;

function EmailCenterPage({ view, data }: { view: EmailSection; data: EmailPageData }): ReactNode {
  const [campaigns, setCampaigns] = useState<EmailCampaignRow[]>(
    view === "campaigns" ? (data as EmailCampaignsData).campaigns : [],
  );
  const [templates, setTemplates] = useState<EmailTemplateRow[]>(
    view === "campaigns"
      ? (data as EmailCampaignsData).templates
      : view === "templates"
        ? (data as EmailTemplatesData).templates
        : [],
  );
  const [variables, setVariables] = useState<MessageVariableRow[]>(
    view === "templates"
      ? (data as EmailTemplatesData).variables
      : view === "variables"
        ? (data as EmailVariablesData).variables
        : [],
  );
  const [archivedCampaigns, setArchivedCampaigns] = useState<EmailCampaignRow[]>(
    view === "archive" ? (data as EmailArchiveData).campaigns : [],
  );
  const [archivedTemplates, setArchivedTemplates] = useState<EmailTemplateRow[]>(
    view === "archive" ? (data as EmailArchiveData).templates : [],
  );
  const [segments, setSegments] = useState<SegmentOption[]>(
    view === "campaigns" ? (data as EmailCampaignsData).segments : [],
  );
  const [topics, setTopics] = useState<TopicOption[]>(
    view === "campaigns" ? (data as EmailCampaignsData).topics : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaignRow | null>(null);
  const [editingVariable, setEditingVariable] = useState<MessageVariableRow | null>(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      if (view === "campaigns") {
        const result = await loadEmailCampaigns();
        setCampaigns(result.campaigns);
        setTemplates(result.templates);
        setSegments(result.segments);
        setTopics(result.topics);
      } else if (view === "templates") {
        const result = await loadEmailTemplates();
        setTemplates(result.templates);
        setVariables(result.variables);
      } else if (view === "variables") {
        const result = await loadEmailVariables();
        setVariables(result.variables);
      } else {
        const result = await loadEmailArchive();
        setArchivedCampaigns(result.campaigns);
        setArchivedTemplates(result.templates);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "メール情報を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [view]);

  const pageTitle = {
    campaigns: "メールキャンペーン",
    templates: "メールテンプレート",
    variables: "メッセージ変数",
    archive: "メールアーカイブ",
  }[view];

  const action =
    view === "campaigns" ? (
      <Button
        onClick={() => {
          setEditingCampaign(null);
          setShowCampaignForm(true);
        }}
      >
        <Plus data-icon="inline-start" />
        メールキャンペーン
      </Button>
    ) : view === "templates" ? (
      <Button onClick={() => setShowTemplateForm(true)}>
        <Plus data-icon="inline-start" />
        Resend Template
      </Button>
    ) : view === "variables" ? (
      <Button
        onClick={() => {
          setEditingVariable(null);
          setShowVariableForm(true);
        }}
      >
        <Plus data-icon="inline-start" />
        メッセージ変数
      </Button>
    ) : undefined;

  return (
    <PageLayout title={pageTitle} action={action}>
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}

      {view === "campaigns" ? (
        <>
          <EmailSummary campaigns={campaigns} templates={templates} />
          <CampaignTable
            items={campaigns}
            loading={loading}
            onEdit={(campaign) => {
              setEditingCampaign(campaign);
              setShowCampaignForm(true);
            }}
            onChanged={load}
          />
        </>
      ) : null}

      {view === "templates" ? (
        <>
          <TemplateTable items={templates} loading={loading} onChanged={load} />
          <VariableReference variables={variables} />
        </>
      ) : null}

      {view === "variables" ? (
        <>
          <VariableReference variables={variables} />
          <VariableTable
            items={variables}
            loading={loading}
            onEdit={(variable) => {
              setEditingVariable(variable);
              setShowVariableForm(true);
            }}
            onChanged={load}
          />
        </>
      ) : null}

      {view === "archive" ? (
        <ArchivedResources
          campaigns={archivedCampaigns}
          templates={archivedTemplates}
          loading={loading}
        />
      ) : null}

      <AppDialog
        open={showCampaignForm}
        onOpenChange={setShowCampaignForm}
        title={editingCampaign ? "メールキャンペーンを編集" : "メールキャンペーンを作成"}
        description="配信対象、テンプレート、送信タイミングを設定します。"
        className="sm:max-w-xl"
      >
        <CampaignForm
          campaign={editingCampaign}
          segments={segments}
          templates={templates.filter(
            (template) => template.purpose === "marketing" && template.sendable,
          )}
          topics={topics}
          onSaved={async () => {
            setShowCampaignForm(false);
            setEditingCampaign(null);
            await load();
          }}
        />
      </AppDialog>

      <AppDialog
        open={showTemplateForm}
        onOpenChange={setShowTemplateForm}
        title="Resend Templateを登録"
        description="Resendで作成・公開したテンプレートをKaenmaから利用できるようにします。"
        className="sm:max-w-xl"
      >
        <TemplateForm
          onSaved={async () => {
            setShowTemplateForm(false);
            await load();
          }}
        />
      </AppDialog>

      <AppDialog
        open={showVariableForm}
        onOpenChange={setShowVariableForm}
        title={editingVariable ? "メッセージ変数を編集" : "メッセージ変数を作成"}
        description="Resend Template内では MESSAGE_KEY の形式で登録します。"
      >
        <VariableForm
          variable={editingVariable}
          onSaved={async () => {
            setShowVariableForm(false);
            setEditingVariable(null);
            await load();
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function EmailSummary({
  campaigns,
  templates,
}: {
  campaigns: EmailCampaignRow[];
  templates: EmailTemplateRow[];
}): ReactNode {
  const scheduled = campaigns.filter((item) => item.status === "scheduled").length;
  const sent = campaigns.reduce((total, item) => total + item.sent_count, 0);
  const delivered = campaigns.reduce((total, item) => total + item.delivered_count, 0);
  const cards = [
    {
      label: "稼働中・予約",
      value: scheduled + campaigns.filter((item) => item.status === "sending").length,
      description: "予約済みまたは送信中",
      icon: CalendarClock,
    },
    {
      label: "送信",
      value: sent,
      description: "現在のキャンペーン合計",
      icon: Send,
    },
    {
      label: "到達",
      value: delivered,
      description: sent > 0 ? `到達率 ${Math.round((delivered / sent) * 100)}%` : "配信後に集計",
      icon: UsersRound,
    },
    {
      label: "テンプレート",
      value: templates.length,
      description: "利用可能なテンプレート",
      icon: FileText,
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl">{card.value.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <card.icon />
            {card.description}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CampaignTable({
  items,
  loading,
  onEdit,
  onChanged,
}: {
  items: EmailCampaignRow[];
  loading: boolean;
  onEdit: (campaign: EmailCampaignRow) => void;
  onChanged: () => Promise<void>;
}): ReactNode {
  async function start(campaign: EmailCampaignRow) {
    try {
      await rpc(`/broadcasts/${campaign.id}/start`, { method: "POST" });
      toast.success("メールキャンペーンの送信を開始しました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "送信を開始できませんでした");
    }
  }

  async function archive(campaign: EmailCampaignRow) {
    try {
      await rpc(`/broadcasts/${campaign.id}/archive`, { method: "POST" });
      toast.success("メールキャンペーンをアーカイブしました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "アーカイブできませんでした");
    }
  }

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        title="メールキャンペーンがありません"
        description="最初の配信を作成して、セグメントへメールを届けましょう。"
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>キャンペーン</TableHead>
            <TableHead>配信対象</TableHead>
            <TableHead>状態</TableHead>
            <TableHead>送信 / 到達</TableHead>
            <TableHead>配信日時</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 6 }).map((__, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-28" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : items.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <div className="flex min-w-48 flex-col gap-1">
                      <span className="font-medium">{campaign.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {campaign.template_name} · {campaign.subject}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span>{campaign.segment_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {campaign.member_count.toLocaleString()}件
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EmailCampaignStatusBadge status={campaign.status} />
                  </TableCell>
                  <TableCell>
                    {campaign.sent_count.toLocaleString()} /{" "}
                    {campaign.delivered_count.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {campaign.scheduled_at
                      ? formatDateTime(campaign.scheduled_at)
                      : campaign.started_at
                        ? formatDateTime(campaign.started_at)
                        : "未設定"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {campaign.status === "draft" || campaign.status === "scheduled" ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => onEdit(campaign)}>
                            <Pencil data-icon="inline-start" />
                            編集
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger render={<Button size="sm" />}>
                              <Send data-icon="inline-start" />
                              今すぐ送信
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogMedia>
                                  <Send />
                                </AlertDialogMedia>
                                <AlertDialogTitle>配信を開始しますか？</AlertDialogTitle>
                                <AlertDialogDescription>
                                  「{campaign.segment_name}
                                  」の現在の対象者を確定し、 Resendから送信します。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void start(campaign)}>
                                  送信を開始
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : null}
                      {campaign.status !== "sending" ? (
                        <ArchiveConfirm
                          label={campaign.name}
                          onConfirm={() => void archive(campaign)}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TemplateTable({
  items,
  loading,
  onChanged,
}: {
  items: EmailTemplateRow[];
  loading: boolean;
  onChanged: () => Promise<void>;
}): ReactNode {
  async function sync(template: EmailTemplateRow) {
    try {
      await rpc(`/email-templates/${template.id}/sync`, {
        method: "POST",
      });
      toast.success("Resend Templateを同期しました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "テンプレートを同期できませんでした");
    }
  }

  async function archive(template: EmailTemplateRow) {
    try {
      await rpc(`/email-templates/${template.id}/archive`, {
        method: "POST",
      });
      toast.success("テンプレートをアーカイブしました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "アーカイブできませんでした");
    }
  }

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        title="テンプレートがありません"
        description="Resendで公開したテンプレートを登録してください。"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>テンプレート</TableHead>
            <TableHead>件名</TableHead>
            <TableHead>用途</TableHead>
            <TableHead>Resend</TableHead>
            <TableHead>同期状態</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 6 }).map((__, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-28" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : items.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
                    <div className="flex min-w-48 flex-col gap-1">
                      <span className="font-medium">{template.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {template.resend_alias ?? template.resend_template_id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-80 truncate">
                    {template.subject ?? "件名なし"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {template.purpose === "marketing" ? "Marketing" : "Transactional"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        variant={template.remote_status === "published" ? "secondary" : "outline"}
                      >
                        {template.remote_status === "published" ? "公開済み" : "下書き"}
                      </Badge>
                      {template.has_unpublished_versions ? (
                        <Badge variant="outline">未公開の変更あり</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-44 flex-col gap-1">
                      <span>{formatDateTime(template.last_synced_at)}</span>
                      {template.sync_error ? (
                        <span className="text-xs text-destructive">{template.sync_error}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">送信可能</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => void sync(template)}>
                        <RefreshCw data-icon="inline-start" />
                        同期
                      </Button>
                      <ArchiveConfirm
                        label={template.name}
                        onConfirm={() => void archive(template)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VariableReference({ variables }: { variables: MessageVariableRow[] }): ReactNode {
  const builtInVariables = [
    ["{{{CONTACT_FIRST_NAME}}}", "連絡先の名"],
    ["{{{CONTACT_LAST_NAME}}}", "連絡先の姓"],
    ["{{{CONTACT_EMAIL}}}", "メールアドレス"],
    ["{{{KAENMA_UNSUBSCRIBE_URL}}}", "配信停止URL（Marketing必須）"],
    ["{{{CONTACT_CUSTOM_KEY}}}", "カスタム属性（KEYを置換）"],
    ...variables.map(
      (variable) =>
        [messageVariableToken(variable.key), `メッセージ変数: ${variable.name}`] as const,
    ),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resend Template変数</CardTitle>
        <CardDescription>
          Resend側で同名の変数を登録し、テンプレート内で利用してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {builtInVariables.map(([token, label]) => (
          <div
            key={token}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <code className="text-sm">{token}</code>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <CopyButton value={token} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function VariableTable({
  items,
  loading,
  onEdit,
  onChanged,
}: {
  items: MessageVariableRow[];
  loading: boolean;
  onEdit: (variable: MessageVariableRow) => void;
  onChanged: () => Promise<void>;
}): ReactNode {
  async function archive(variable: MessageVariableRow) {
    try {
      await rpc(`/message-variables/${variable.id}/archive`, {
        method: "POST",
      });
      toast.success("メッセージ変数をアーカイブしました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "アーカイブできませんでした");
    }
  }
  if (!loading && items.length === 0) {
    return (
      <EmptyState
        title="メッセージ変数がありません"
        description="ブランド名、会社住所、共通署名などを登録できます。"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名前</TableHead>
            <TableHead>変数</TableHead>
            <TableHead>値</TableHead>
            <TableHead>更新日</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 2 }).map((_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 5 }).map((__, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-5 w-28" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : items.map((variable) => {
                const token = messageVariableToken(variable.key);
                return (
                  <TableRow key={variable.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{variable.name}</span>
                        {variable.description ? (
                          <span className="text-xs text-muted-foreground">
                            {variable.description}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code>{token}</code>
                        <CopyButton value={token} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-80 truncate">
                      {variable.value || "空の値"}
                    </TableCell>
                    <TableCell>{formatDateTime(variable.updated_at)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => onEdit(variable)}>
                          <Pencil data-icon="inline-start" />
                          編集
                        </Button>
                        <ArchiveConfirm
                          label={variable.name}
                          onConfirm={() => void archive(variable)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
        </TableBody>
      </Table>
    </div>
  );
}

function ArchivedResources({
  campaigns,
  templates,
  loading,
}: {
  campaigns: EmailCampaignRow[];
  templates: EmailTemplateRow[];
  loading: boolean;
}): ReactNode {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (campaigns.length === 0 && templates.length === 0) {
    return (
      <EmptyState
        title="アーカイブは空です"
        description="終了したキャンペーンや使わなくなったテンプレートがここに表示されます。"
      />
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>キャンペーン</CardTitle>
          <CardDescription>{campaigns.length}件</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{campaign.name}</p>
                <p className="text-xs text-muted-foreground">
                  {campaign.segment_name} · {formatDateTime(campaign.updated_at)}
                </p>
              </div>
              <EmailCampaignStatusBadge status={campaign.status} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>テンプレート</CardTitle>
          <CardDescription>{templates.length}件</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{template.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {template.subject ?? "件名なし"}
                </p>
              </div>
              <Badge variant="secondary">
                {template.remote_status === "published" ? "公開済み" : "下書き"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignForm({
  campaign,
  segments,
  templates,
  topics,
  onSaved,
}: {
  campaign: EmailCampaignRow | null;
  segments: SegmentOption[];
  templates: EmailTemplateRow[];
  topics: TopicOption[];
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const scheduledAt = getFormString(form, "scheduledAt").trim();
    try {
      await rpc(campaign ? `/broadcasts/${campaign.id}` : "/broadcasts", {
        method: campaign ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.get("name"),
          segmentId: form.get("segmentId"),
          templateId: form.get("templateId"),
          topicId: nullableString(form.get("topicId")),
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      });
      toast.success(
        campaign ? "メールキャンペーンを更新しました" : "メールキャンペーンを作成しました",
      );
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "メールキャンペーンを保存できませんでした",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <FormInput
          label="キャンペーン名"
          name="name"
          defaultValue={campaign?.name}
          placeholder="8月のプロダクトアップデート"
          required
        />
        <FormNativeSelect
          label="配信対象セグメント"
          name="segmentId"
          defaultValue={campaign?.segment_id}
          required
        >
          <FormSelectOption value="">選択してください</FormSelectOption>
          {segments.map((segment) => (
            <FormSelectOption key={segment.id} value={segment.id}>
              {segment.name}（{segment.member_count.toLocaleString()}件）
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="メールテンプレート"
          name="templateId"
          defaultValue={campaign?.template_id}
          required
        >
          <FormSelectOption value="">選択してください</FormSelectOption>
          {templates.map((template) => (
            <FormSelectOption key={template.id} value={template.id}>
              {template.name}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormNativeSelect
          label="配信トピック"
          name="topicId"
          defaultValue={campaign?.topic_id ?? ""}
          description="未設定の場合はグローバルな配信停止設定を使用します。"
        >
          <FormSelectOption value="">グローバル</FormSelectOption>
          {topics.map((topic) => (
            <FormSelectOption key={topic.id} value={topic.id}>
              {topic.name}
              {topic.is_default ? "（既定）" : ""}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
        <FormInput
          label="予約配信"
          name="scheduledAt"
          type="datetime-local"
          defaultValue={toDateTimeLocal(campaign?.scheduled_at)}
          description="空欄で保存すると下書きになります。"
        />
        <LoadingButton busy={busy} type="submit" className="w-full">
          {campaign ? "変更を保存" : "キャンペーンを作成"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function TemplateForm({ onSaved }: { onSaved: () => Promise<void> }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await rpc("/email-templates", {
        method: "POST",
        body: JSON.stringify({
          resendTemplateId: form.get("resendTemplateId"),
          purpose: form.get("purpose"),
        }),
      });
      toast.success("Resend Templateを登録しました");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resend Templateを登録できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <FormInput
          label="Resend Template IDまたはAlias"
          name="resendTemplateId"
          placeholder="welcome-email"
          description="ResendのTemplates画面で公開済みのTemplate IDまたはAliasを入力します。"
          required
        />
        <FormNativeSelect label="用途" name="purpose" defaultValue="marketing">
          <FormSelectOption value="marketing">Marketing（Resend）</FormSelectOption>
          <FormSelectOption value="transactional">Transactional（Resend）</FormSelectOption>
        </FormNativeSelect>
        <Button
          type="button"
          variant="outline"
          render={
            <a
              href="https://resend.com/templates"
              target="_blank"
              rel="noreferrer"
              aria-label="Resend Templatesを開く"
            />
          }
        >
          <ExternalLink data-icon="inline-start" />
          Resend Templatesを開く
        </Button>
        <LoadingButton busy={busy} type="submit" className="w-full">
          テンプレートを登録
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function VariableForm({
  variable,
  onSaved,
}: {
  variable: MessageVariableRow | null;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await rpc(variable ? `/message-variables/${variable.id}` : "/message-variables", {
        method: variable ? "PATCH" : "POST",
        body: JSON.stringify({
          key: form.get("key"),
          name: form.get("name"),
          value: form.get("value"),
          description: form.get("description"),
        }),
      });
      toast.success(variable ? "メッセージ変数を更新しました" : "メッセージ変数を作成しました");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "メッセージ変数を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <FormInput
          label="表示名"
          name="name"
          defaultValue={variable?.name}
          placeholder="ブランド名"
          required
        />
        <FormInput
          label="キー"
          name="key"
          defaultValue={variable?.key}
          placeholder="brand_name"
          pattern="[a-z][a-z0-9_]*"
          description="英小文字で始まり、英小文字・数字・_のみ使用できます。"
          required
        />
        <FormTextarea label="値" name="value" defaultValue={variable?.value} rows={5} required />
        <FormTextarea
          label="説明"
          name="description"
          defaultValue={variable?.description}
          rows={2}
        />
        <LoadingButton busy={busy} type="submit" className="w-full">
          {variable ? "変更を保存" : "変数を作成"}
        </LoadingButton>
      </FieldGroup>
    </form>
  );
}

function ArchiveConfirm({ label, onConfirm }: { label: string; onConfirm: () => void }): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button size="sm" variant="ghost" aria-label={`${label}をアーカイブ`} />}
      >
        <Archive />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Archive />
          </AlertDialogMedia>
          <AlertDialogTitle>アーカイブしますか？</AlertDialogTitle>
          <AlertDialogDescription>
            「{label}」を通常の一覧から非表示にします。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            アーカイブ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmailCampaignStatusBadge({ status }: { status: EmailCampaignRow["status"] }): ReactNode {
  const labels: Record<EmailCampaignRow["status"], string> = {
    draft: "下書き",
    scheduled: "予約済み",
    sending: "送信中",
    completed: "完了",
    cancelled: "停止",
  };
  const variant =
    status === "cancelled"
      ? "destructive"
      : status === "draft"
        ? "outline"
        : status === "completed"
          ? "secondary"
          : "default";
  return <Badge variant={variant}>{labels[status]}</Badge>;
}

function CopyButton({ value }: { value: string }): ReactNode {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={`${value}をコピー`}
      onClick={() => void copyValue(value)}
    >
      <Copy />
    </Button>
  );
}

async function copyValue(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast.success("クリップボードにコピーしました");
}

function messageVariableToken(key: string): string {
  const normalized = key.replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return `{{{MESSAGE_${normalized}}}}`;
}

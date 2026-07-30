import { Copy, Pencil, RefreshCw, Send } from "lucide-react";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/app-ui";
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
  type EmailCampaignRow,
  type EmailTemplateRow,
  type MessageVariableRow,
} from "@/features/emails/email-api";
import { formatDateTime } from "@/lib/format";
import { rpc } from "@/rpc";

import { ArchiveConfirm } from "./email-forms";

export function CampaignTable({
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

export function TemplateTable({
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

export function VariableReference({ variables }: { variables: MessageVariableRow[] }): ReactNode {
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

export function VariableTable({
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

export function ArchivedResources({
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

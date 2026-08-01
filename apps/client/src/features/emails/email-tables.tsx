import { Pencil, RefreshCw, Send } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type EmailCampaignRow, type EmailTemplateRow } from "@/features/emails/email-api";
import { formatDateTime } from "@/lib/format";
import { orpc } from "@/lib/orpc";

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
      await orpc.emails.startCampaign({ id: campaign.id });
      toast.success("メールキャンペーンの送信を開始しました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "送信を開始できませんでした");
    }
  }

  async function archive(campaign: EmailCampaignRow) {
    try {
      await orpc.emails.archiveCampaign({ id: campaign.id });
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
                        {campaign.templateName} · {campaign.subject}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span>{campaign.segmentName}</span>
                      <span className="text-xs text-muted-foreground">
                        {campaign.memberCount.toLocaleString()}件
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EmailCampaignStatusBadge status={campaign.status} />
                  </TableCell>
                  <TableCell>
                    {campaign.sentCount.toLocaleString()} /{" "}
                    {campaign.deliveredCount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {campaign.scheduledAt
                      ? formatDateTime(campaign.scheduledAt)
                      : campaign.startedAt
                        ? formatDateTime(campaign.startedAt)
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
                                  「{campaign.segmentName}
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
      await orpc.emails.syncTemplate({ id: template.id });
      toast.success("Resend Templateを同期しました");
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "テンプレートを同期できませんでした");
    }
  }

  async function archive(template: EmailTemplateRow) {
    try {
      await orpc.emails.archiveTemplate({ id: template.id });
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
                        {template.resendAlias ?? template.resendTemplateId}
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
                        variant={template.remoteStatus === "published" ? "secondary" : "outline"}
                      >
                        {template.remoteStatus === "published" ? "公開済み" : "下書き"}
                      </Badge>
                      {template.hasUnpublishedVersions ? (
                        <Badge variant="outline">未公開の変更あり</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-44 flex-col gap-1">
                      <span>{formatDateTime(template.lastSyncedAt)}</span>
                      {template.syncError ? (
                        <span className="text-xs text-destructive">{template.syncError}</span>
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

export function EmailCampaignStatusBadge({
  status,
}: {
  status: EmailCampaignRow["status"];
}): ReactNode {
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

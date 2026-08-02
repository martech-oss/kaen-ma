import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, RefreshCw, Send } from "lucide-react";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { ArchiveConfirm } from "@/components/app-ui";
import { type DataTableColumn, DataTable } from "@/components/data-table";
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
import { type EmailCampaignRow, type EmailTemplateRow } from "@/features/emails/email-api";
import { formatDateTime } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";

export function CampaignTable({
  items,
  loading,
  onEdit,
}: {
  items: EmailCampaignRow[];
  loading: boolean;
  onEdit: (campaign: EmailCampaignRow) => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const startCampaign = useMutation(orpcQuery.emails.startCampaign.mutationOptions());
  const archiveCampaign = useMutation(orpcQuery.emails.archiveCampaign.mutationOptions());

  async function start(campaign: EmailCampaignRow) {
    try {
      await startCampaign.mutateAsync({ id: campaign.id });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listCampaigns.key() });
      toast.success("メールキャンペーンの送信を開始しました");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "送信を開始できませんでした");
    }
  }

  async function archive(campaign: EmailCampaignRow) {
    try {
      await archiveCampaign.mutateAsync({ id: campaign.id });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listCampaigns.key() });
      toast.success("メールキャンペーンをアーカイブしました");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "アーカイブできませんでした");
    }
  }

  const columns: DataTableColumn<EmailCampaignRow>[] = [
    {
      key: "campaign",
      header: "キャンペーン",
      cell: (campaign) => (
        <div className="flex min-w-48 flex-col gap-1">
          <span className="font-medium">{campaign.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {campaign.templateName} · {campaign.subject}
          </span>
        </div>
      ),
    },
    {
      key: "target",
      header: "配信対象",
      cell: (campaign) => (
        <div className="flex flex-col gap-1">
          <span>{campaign.segmentName}</span>
          <span className="text-xs text-muted-foreground">
            {campaign.memberCount.toLocaleString()}件
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "状態",
      cell: (campaign) => <EmailCampaignStatusBadge status={campaign.status} />,
    },
    {
      key: "counts",
      header: "送信 / 到達",
      cell: (campaign) =>
        `${campaign.sentCount.toLocaleString()} / ${campaign.deliveredCount.toLocaleString()}`,
    },
    {
      key: "scheduledAt",
      header: "配信日時",
      cell: (campaign) =>
        campaign.scheduledAt
          ? formatDateTime(campaign.scheduledAt)
          : campaign.startedAt
            ? formatDateTime(campaign.startedAt)
            : "未設定",
    },
    {
      key: "actions",
      header: "操作",
      cell: (campaign) => (
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
            <ArchiveConfirm label={campaign.name} onConfirm={() => void archive(campaign)} />
          ) : null}
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border">
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(campaign) => campaign.id}
        caption="メールキャンペーン一覧"
        loading={loading}
        skeletonRowCount={3}
        emptyTitle="メールキャンペーンがありません"
        emptyDescription="最初の配信を作成して、セグメントへメールを届けましょう。"
      />
    </div>
  );
}

export function TemplateTable({
  items,
  loading,
}: {
  items: EmailTemplateRow[];
  loading: boolean;
}): ReactNode {
  const queryClient = useQueryClient();
  const syncTemplate = useMutation(orpcQuery.emails.syncTemplate.mutationOptions());
  const archiveTemplate = useMutation(orpcQuery.emails.archiveTemplate.mutationOptions());

  async function sync(template: EmailTemplateRow) {
    try {
      await syncTemplate.mutateAsync({ id: template.id });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() });
      toast.success("Resend Templateを同期しました");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "テンプレートを同期できませんでした");
    }
  }

  async function archive(template: EmailTemplateRow) {
    try {
      await archiveTemplate.mutateAsync({ id: template.id });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listTemplates.key() });
      toast.success("テンプレートをアーカイブしました");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "アーカイブできませんでした");
    }
  }

  const columns: DataTableColumn<EmailTemplateRow>[] = [
    {
      key: "template",
      header: "テンプレート",
      cell: (template) => (
        <div className="flex min-w-48 flex-col gap-1">
          <span className="font-medium">{template.name}</span>
          <span className="text-xs text-muted-foreground">
            {template.resendAlias ?? template.resendTemplateId}
          </span>
        </div>
      ),
    },
    {
      key: "subject",
      header: "件名",
      cell: (template) => template.subject ?? "件名なし",
      cellClassName: "max-w-80 truncate",
    },
    {
      key: "purpose",
      header: "用途",
      cell: (template) => (
        <Badge variant="outline">
          {template.purpose === "marketing" ? "Marketing" : "Transactional"}
        </Badge>
      ),
    },
    {
      key: "resend",
      header: "Resend",
      cell: (template) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant={template.remoteStatus === "published" ? "secondary" : "outline"}>
            {template.remoteStatus === "published" ? "公開済み" : "下書き"}
          </Badge>
          {template.hasUnpublishedVersions ? (
            <Badge variant="outline">未公開の変更あり</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "sync",
      header: "同期状態",
      cell: (template) => (
        <div className="flex min-w-44 flex-col gap-1">
          <span>{formatDateTime(template.lastSyncedAt)}</span>
          {template.syncError ? (
            <span className="text-xs text-destructive">{template.syncError}</span>
          ) : (
            <span className="text-xs text-muted-foreground">送信可能</span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "操作",
      cell: (template) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void sync(template)}>
            <RefreshCw data-icon="inline-start" />
            同期
          </Button>
          <ArchiveConfirm label={template.name} onConfirm={() => void archive(template)} />
        </div>
      ),
      headClassName: "text-right",
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border">
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(template) => template.id}
        caption="メールテンプレート一覧"
        loading={loading}
        skeletonRowCount={3}
        emptyTitle="テンプレートがありません"
        emptyDescription="Resendで公開したテンプレートを登録してください。"
      />
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

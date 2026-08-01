import type { ReactNode } from "react";

import { EmptyState } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailCampaignRow, EmailTemplateRow } from "@/features/emails/email-api";
import { formatDateTime } from "@/lib/format";

import { EmailCampaignStatusBadge } from "./email-tables";

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
                  {campaign.segmentName} · {formatDateTime(campaign.updatedAt)}
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
                {template.remoteStatus === "published" ? "公開済み" : "下書き"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

import type { ReactNode } from "react";

import { EmptyState } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailTemplateRow } from "@/features/emails/email-api";

export function ArchivedResources({
  templates,
  loading,
}: {
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
  if (templates.length === 0) {
    return (
      <EmptyState
        title="アーカイブは空です"
        description="使わなくなったテンプレートがここに表示されます。"
      />
    );
  }
  return (
    <div className="grid gap-4">
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
                <p className="truncate text-xs text-muted-foreground">{template.subject}</p>
              </div>
              <Badge variant="secondary">{template.sendable ? "公開済み" : "下書き"}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

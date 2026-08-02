import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { ArchiveConfirm, EmptyState } from "@/components/app-ui";
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
import type { MessageVariableRow } from "@/features/emails/email-api";
import { formatDateTime } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";

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
}: {
  items: MessageVariableRow[];
  loading: boolean;
  onEdit: (variable: MessageVariableRow) => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const archiveVariable = useMutation(orpcQuery.emails.archiveVariable.mutationOptions());
  async function archive(variable: MessageVariableRow) {
    try {
      await archiveVariable.mutateAsync({ id: variable.id });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.emails.listVariables.key() });
      toast.success("メッセージ変数をアーカイブしました");
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
                    <TableCell>{formatDateTime(variable.updatedAt)}</TableCell>
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

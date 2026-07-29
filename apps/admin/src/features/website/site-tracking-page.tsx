import { api } from "@/api";
import {
  ErrorAlert,
  FormTextarea,
  LoadingButton,
  PageLayout,
} from "@/components/app-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SiteTrackingData } from "@/features/website/website-api";
import { CopyButton } from "@/features/website/website-shared";
import { formatDateTime } from "@/lib/format";
import { useRouter } from "@tanstack/react-router";
import {
  Activity,
  ChartNoAxesCombined,
  ContactRound,
  Eye,
  Info,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

export function SiteTrackingPage({
  data,
}: {
  data: SiteTrackingData;
}): ReactNode {
  const router = useRouter();
  const [enabled, setEnabled] = useState(data.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trackingCode = buildTrackingCode(data.workspaceSlug);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const allowedDomains = String(formData.get("allowedDomains") ?? "")
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    setBusy(true);
    setError("");
    try {
      await api("/site-tracking", {
        method: "PUT",
        body: JSON.stringify({ enabled, allowedDomains }),
      });
      toast.success("サイトトラッキング設定を保存しました");
      await router.invalidate({ sync: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "設定を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout
      title="サイトトラッキング"
      description="許可したWebサイトの訪問を連絡先の行動履歴へ接続します。"
    >
      <TrackingSummary data={data} />
      <Tabs defaultValue="setup">
        <TabsList>
          <TabsTrigger value="setup">設定と設置コード</TabsTrigger>
          <TabsTrigger value="activity">訪問アクティビティ</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="flex flex-col gap-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card>
              <CardHeader>
                <CardTitle>トラッキング設定</CardTitle>
                <CardDescription>
                  有効化するサイトをホワイトリストで制限します。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={(event) => void save(event)}>
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <Switch
                        id="tracking-enabled"
                        checked={enabled}
                        onCheckedChange={setEnabled}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor="tracking-enabled">
                          <FieldTitle>サイトトラッキング</FieldTitle>
                          <FieldDescription>
                            無効にすると公開エンドポイントは訪問を保存しません。
                          </FieldDescription>
                        </FieldLabel>
                      </FieldContent>
                    </Field>
                    <FormTextarea
                      label="許可ドメイン"
                      name="allowedDomains"
                      defaultValue={data.allowedDomains.join("\n")}
                      description="http:// を除き、1行に1ドメインを入力してください。サブドメインも許可されます。"
                      placeholder={"example.com\ncampaign.example.com"}
                      rows={5}
                    />
                    {error ? <ErrorAlert>{error}</ErrorAlert> : null}
                    <LoadingButton busy={busy} type="submit">
                      設定を保存
                    </LoadingButton>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>設置コード</CardTitle>
                <CardDescription>
                  同意取得後、追跡するすべてのページで読み込んでください。
                </CardDescription>
                <CardAction>
                  <CopyButton value={trackingCode} />
                </CardAction>
              </CardHeader>
              <CardContent>
                <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
                  <code>{trackingCode}</code>
                </pre>
              </CardContent>
            </Card>
          </div>
          <Alert>
            <Info />
            <AlertTitle>訪問者の同意が必須です</AlertTitle>
            <AlertDescription>
              サンプルコードの consent: true は、Cookieバナー等で同意を得た後にだけ設定してください。
              既知の連絡先は kaenma.identify(email) で識別でき、サイトメッセージの対象になります。
            </AlertDescription>
          </Alert>
        </TabsContent>
        <TabsContent value="activity" className="flex flex-col gap-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <TopPages items={data.topPages} />
            <RecentEvents items={data.recentEvents} />
          </div>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

function TrackingSummary({ data }: { data: SiteTrackingData }): ReactNode {
  const cards = [
    {
      label: "30日間のページビュー",
      value: data.summary.pageViews,
      description: "許可サイトで記録",
      icon: Eye,
    },
    {
      label: "ユニーク訪問者",
      value: data.summary.uniqueVisitors,
      description: "Visitor IDベース",
      icon: ChartNoAxesCombined,
    },
    {
      label: "識別済み連絡先",
      value: data.summary.identifiedContacts,
      description: "メールと関連付け済み",
      icon: ContactRound,
    },
    {
      label: "ステータス",
      value: data.enabled ? "ON" : "OFF",
      description: `${data.allowedDomains.length}ドメインを許可`,
      icon: Activity,
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl">
              {typeof card.value === "number"
                ? card.value.toLocaleString()
                : card.value}
            </CardTitle>
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

function TopPages({
  items,
}: {
  items: SiteTrackingData["topPages"];
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>上位ページ</CardTitle>
        <CardDescription>過去30日間のページビュー順です。</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead className="text-right">表示</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item) => (
                <TableRow key={item.url}>
                  <TableCell>
                    <span className="block max-w-96 truncate">{item.url}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {item.views.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={2} className="h-28 text-center text-muted-foreground">
                  まだページビューがありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecentEvents({
  items,
}: {
  items: SiteTrackingData["recentEvents"];
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>最近の訪問</CardTitle>
        <CardDescription>直近20件のページビューです。</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>訪問ページ</TableHead>
              <TableHead>訪問者</TableHead>
              <TableHead>日時</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item, index) => (
                <TableRow key={`${item.visitor_id}-${item.occurred_at}-${index}`}>
                  <TableCell>
                    <span className="block max-w-64 truncate">
                      {item.resource_id}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.contact_id ? "default" : "secondary"}>
                      {item.contact_id ? "識別済み" : "匿名"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(item.occurred_at)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="h-28 text-center text-muted-foreground">
                  まだ訪問データがありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function buildTrackingCode(workspaceSlug: string): string {
  const scriptUrl = `${window.location.origin}/api/public/site-tracking/${workspaceSlug}/script.js`;
  return `<script>
  window.kaenmaSettings = {
    consent: true
  };
</script>
<script async src="${scriptUrl}"></script>`;
}

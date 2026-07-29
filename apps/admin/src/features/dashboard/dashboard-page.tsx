import { PageLayout, SimpleEmpty } from "@/components/app-ui";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/format";
import { Activity, Gauge, Send, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

export interface DashboardData {
  contacts: { count: number };
  campaigns: { count: number };
  deliveries: { sent: number; delivered: number; failed: number };
  recentEvents: Array<{ type: string; occurred_at: string }>;
}

export function DashboardPage({ data }: { data: DashboardData }): ReactNode {
  const deliveredRate =
    data.deliveries.sent > 0
      ? Math.round((data.deliveries.delivered / data.deliveries.sent) * 1000) /
        10
      : 0;
  const cards = [
    {
      label: "アクティブ連絡先",
      value: data.contacts.count.toLocaleString(),
      icon: UsersRound,
    },
    {
      label: "公開キャンペーン",
      value: data.campaigns.count.toLocaleString(),
      icon: Activity,
    },
    {
      label: "30日間の配信",
      value: data.deliveries.sent.toLocaleString(),
      icon: Send,
    },
    { label: "配信到達率", value: `${deliveredRate}%`, icon: Gauge },
  ];

  return (
    <PageLayout
      title="ダッシュボード"
      description="獲得・自動化・配信の現在地を確認します。"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardAction>
                <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                  <card.icon className="size-4" />
                </div>
              </CardAction>
              <CardTitle className="text-3xl font-semibold tabular-nums">
                {card.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="min-h-80">
          <CardHeader>
            <CardTitle>配信ヘルス</CardTitle>
            <CardDescription>直近7期間の配信到達率</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-44 items-end gap-3">
              {[45, 56, 38, 70, 62, 83, Math.max(12, deliveredRate)].map(
                (height, index) => (
                  <div
                    key={index}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <div
                      className="w-full rounded-t-md bg-primary"
                      style={{
                        height: `${height}%`,
                        opacity: 0.45 + index * 0.08,
                      }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最近のイベント</CardTitle>
            <CardDescription>
              ワークスペースの最新アクティビティ
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentEvents.length === 0 ? (
              <SimpleEmpty compact label="まだイベントがありません" />
            ) : (
              data.recentEvents.slice(0, 8).map((event, index) => (
                <div key={`${event.occurred_at}-${index}`}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex gap-3 py-3">
                    <span className="mt-1 size-2 rounded-full bg-success" />
                    <div>
                      <div className="text-sm font-medium">{event.type}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(event.occurred_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

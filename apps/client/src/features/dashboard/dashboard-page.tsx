import type { Dashboard as DashboardData } from "@openengage/orpc";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Activity, Gauge, Send, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
import {
  dashboardQueryOptions,
  deliveryTrendQueryOptions,
  toDeliveryHealthTrend,
} from "@/features/dashboard/dashboard-api";
import { formatDateTime, formatShortDate } from "@/lib/format";

export type { DashboardData };

export function DashboardPage(): ReactNode {
  const { data } = useSuspenseQuery(dashboardQueryOptions());
  const { data: trendReport } = useSuspenseQuery(deliveryTrendQueryOptions());
  const deliveryHealth = toDeliveryHealthTrend(trendReport.trend);
  const deliveredRate =
    data.deliveries.sent > 0
      ? Math.round((data.deliveries.delivered / data.deliveries.sent) * 1000) / 10
      : 0;
  const cards = [
    {
      label: "アクティブ連絡先",
      value: data.contacts.count.toLocaleString(),
      icon: UsersRound,
    },
    {
      label: "公開オートメーション",
      value: data.automations.count.toLocaleString(),
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
    <PageLayout title="ダッシュボード">
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
              <CardTitle className="text-3xl font-semibold tabular-nums">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="min-h-80">
          <CardHeader>
            <CardTitle>配信ヘルス</CardTitle>
            <CardDescription>直近7日間の配信到達率</CardDescription>
          </CardHeader>
          <CardContent>
            {deliveryHealth.every((point) => point.deliveryRate === 0) ? (
              <SimpleEmpty compact label="この期間の配信データはありません" />
            ) : (
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={deliveryHealth}
                    margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(value: string) => formatShortDate(value)}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                      unit="%"
                      domain={[0, 100]}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)" }}
                      labelFormatter={(value) =>
                        formatShortDate(typeof value === "string" ? value : "")
                      }
                      formatter={(value) => [`${Number(value)}%`, "配信到達率"]}
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        borderColor: "var(--border)",
                        borderRadius: "var(--radius)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="deliveryRate" fill="var(--primary)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最近のイベント</CardTitle>
            <CardDescription>ワークスペースの最新アクティビティ</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentEvents.length === 0 ? (
              <SimpleEmpty compact label="まだイベントがありません" />
            ) : (
              data.recentEvents.slice(0, 8).map((event, index) => (
                <div key={`${event.occurredAt}-${index}`}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex gap-3 py-3">
                    <span className="mt-1 size-2 rounded-full bg-success" />
                    <div>
                      <div className="text-sm font-medium">{event.type}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(event.occurredAt)}
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

import { type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableCell } from "@/components/ui/table";
import { formatShortDate } from "@/lib/format";

export function MetricGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

export function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </CardTitle>
        {icon ? (
          <CardAction>
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted [&>svg]:size-4">
              {icon}
            </span>
          </CardAction>
        ) : null}
      </CardHeader>
    </Card>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: string | number }>;
  label?: string;
  series: Array<{ key: string; label: string; color: string }>;
}): ReactNode {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{formatShortDate(label ?? "")}</p>
      <div className="flex flex-col gap-1">
        {series.map((item) => {
          const entry = payload.find((point) => point.dataKey === item.key);
          if (!entry) return null;
          return (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <span className="font-medium tabular-nums">
                {Number(entry.value ?? 0).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrendCard({
  title,
  description,
  data,
  series,
}: {
  title: string;
  description: string;
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string; color: string }>;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <div className="flex flex-wrap justify-end gap-3 text-xs text-muted-foreground">
            {series.map((item) => (
              <span key={item.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <NoReportData />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(value: string) => formatShortDate(value)}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<TrendTooltip series={series} />}
                  cursor={{ fill: "var(--muted)" }}
                />
                {series.map((item) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    fill={item.color}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RankingCard({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ id: string; name: string; color: string; contactCount: number }>;
}): ReactNode {
  const maximum = Math.max(1, ...items.map((item) => item.contactCount));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => (
          <div key={item.id}>
            <div className="mb-1.5 flex justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate">{item.name}</span>
              </span>
              <span className="tabular-nums">{item.contactCount.toLocaleString()}人</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(item.contactCount / maximum) * 100}%` }}
              />
            </div>
          </div>
        ))}
        {items.length === 0 ? <NoReportData /> : null}
      </CardContent>
    </Card>
  );
}

export function ReportTableCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">{children}</CardContent>
    </Card>
  );
}

export function NumberCell({ value }: { value: number }): ReactNode {
  return <TableCell className="text-right tabular-nums">{value.toLocaleString()}</TableCell>;
}

export function ReportStatusBadge({ status }: { status: string }): ReactNode {
  const labels: Record<string, string> = {
    active: "有効",
    paused: "一時停止",
    draft: "下書き",
    published: "公開",
  };
  return (
    <Badge variant={status === "active" || status === "published" ? "default" : "secondary"}>
      {labels[status] ?? status}
    </Badge>
  );
}

export function ProgressRow({
  label,
  value,
  maximum,
  destructive = false,
}: {
  label: string;
  value: number;
  maximum: number;
  destructive?: boolean;
}): ReactNode {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${destructive ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.min(100, (value / Math.max(maximum, 1)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function AttentionItem({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-medium tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

export function NoReportData(): ReactNode {
  return (
    <EmptyState
      compact
      title="この期間のデータはありません"
      description="期間を変更するか、データが蓄積されてから確認してください。"
    />
  );
}

export function sourceTypeLabel(type: string): string {
  if (type === "broadcast") return "一斉配信";
  if (type === "automation") return "オートメーション";
  return "Transactional";
}

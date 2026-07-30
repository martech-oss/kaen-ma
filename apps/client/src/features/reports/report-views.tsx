import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CircleDollarSign,
  Globe2,
  Send,
  TrendingUp,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { type ReactNode } from "react";

import { FormNativeSelect, FormSelectOption } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AutomationsReport,
  type ContactsReport,
  type DealsReport,
  type EmailsReport,
  type ReportSearch,
  type SiteReport,
} from "@/features/reports/report-api";
import { formatMoney, formatPercent, rate } from "@/lib/format";

import {
  Metric,
  MetricGrid,
  NoReportData,
  NumberCell,
  ProgressRow,
  RankingCard,
  ReportStatusBadge,
  ReportTableCard,
  sourceTypeLabel,
  TrendCard,
} from "./report-widgets";

export function ContactsReportView({ report }: { report: ContactsReport }): ReactNode {
  return (
    <>
      <MetricGrid>
        <Metric label="総連絡先" value={report.summary.totalContacts} icon={<UsersRound />} />
        <Metric label="アクティブ" value={report.summary.activeContacts} icon={<UserCheck />} />
        <Metric label="期間内の新規" value={report.summary.newContacts} icon={<TrendingUp />} />
        <Metric
          label="期間内のアーカイブ"
          value={report.summary.archivedContacts}
          icon={<Activity />}
        />
      </MetricGrid>
      <TrendCard
        title="連絡先の推移"
        description="期間内に追加・アーカイブされた連絡先"
        data={report.trend}
        series={[
          { key: "added", label: "追加", color: "#3b82f6" },
          { key: "archived", label: "アーカイブ", color: "#f97316" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingCard
          title="上位リスト"
          description="現在のアクティブ連絡先数"
          items={report.topLists}
        />
        <RankingCard
          title="上位タグ"
          description="現在のアクティブ連絡先数"
          items={report.topTags}
        />
      </div>
    </>
  );
}

export function AutomationsReportView({ report }: { report: AutomationsReport }): ReactNode {
  return (
    <>
      <MetricGrid>
        <Metric label="オートメーション" value={report.summary.automationCount} />
        <Metric label="参加" value={report.summary.entries} />
        <Metric
          label="完了率"
          value={formatPercent(report.summary.completionRate)}
          icon={<TrendingUp />}
        />
        <Metric label="現在進行中" value={report.summary.activeContacts} icon={<Activity />} />
        <Metric label="メール開封率" value={formatPercent(report.summary.openRate)} />
        <Metric label="メールクリック率" value={formatPercent(report.summary.clickRate)} />
      </MetricGrid>
      <TrendCard
        title="参加と完了の推移"
        description="オートメーションへ入った回数と完了した回数"
        data={report.trend}
        series={[
          { key: "entries", label: "参加", color: "#8b5cf6" },
          { key: "completions", label: "完了", color: "#10b981" },
        ]}
      />
      <ReportTableCard title="オートメーション別パフォーマンス">
        <Table>
          <TableCaption className="sr-only">オートメーション別レポート</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">オートメーション</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">参加</TableHead>
              <TableHead className="text-right">完了</TableHead>
              <TableHead className="text-right">進行中</TableHead>
              <TableHead className="text-right">送信</TableHead>
              <TableHead className="text-right">開封率</TableHead>
              <TableHead className="px-4 text-right">クリック率</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.automations.map((automation) => (
              <TableRow key={automation.id}>
                <TableCell className="px-4 font-medium">
                  <Link
                    to="/campaigns/$id"
                    params={{ id: automation.id }}
                    className="hover:underline"
                  >
                    {automation.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <ReportStatusBadge status={automation.status} />
                </TableCell>
                <NumberCell value={automation.entries} />
                <NumberCell value={automation.completions} />
                <NumberCell value={automation.activeContacts} />
                <NumberCell value={automation.sends} />
                <TableCell className="text-right">
                  {formatPercent(rate(automation.opens, automation.sends))}
                </TableCell>
                <TableCell className="px-4 text-right">
                  {formatPercent(rate(automation.clicks, automation.sends))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {report.automations.length === 0 ? <NoReportData /> : null}
      </ReportTableCard>
    </>
  );
}

export function EmailsReportView({ report }: { report: EmailsReport }): ReactNode {
  return (
    <>
      <MetricGrid>
        <Metric label="送信" value={report.summary.sends} icon={<Send />} />
        <Metric label="到達率" value={formatPercent(report.summary.deliveryRate)} />
        <Metric label="開封率" value={formatPercent(report.summary.openRate)} />
        <Metric label="クリック率" value={formatPercent(report.summary.clickRate)} />
        <Metric label="CTOR" value={formatPercent(report.summary.clickToOpenRate)} />
        <Metric label="バウンス率" value={formatPercent(report.summary.bounceRate)} />
      </MetricGrid>
      <TrendCard
        title="メールパフォーマンス"
        description="送信・到達・ユニーク開封・ユニーククリック"
        data={report.trend}
        series={[
          { key: "sends", label: "送信", color: "#64748b" },
          { key: "delivered", label: "到達", color: "#3b82f6" },
          { key: "opens", label: "開封", color: "#8b5cf6" },
          { key: "clicks", label: "クリック", color: "#10b981" },
        ]}
      />
      <ReportTableCard title="キャンペーン／オートメーション別">
        <Table>
          <TableCaption className="sr-only">メール配信元別レポート</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">配信元</TableHead>
              <TableHead>種別</TableHead>
              <TableHead className="text-right">送信</TableHead>
              <TableHead className="text-right">到達</TableHead>
              <TableHead className="text-right">開封率</TableHead>
              <TableHead className="text-right">クリック率</TableHead>
              <TableHead className="text-right">バウンス</TableHead>
              <TableHead className="px-4 text-right">配信停止</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.sources.map((source) => (
              <TableRow key={`${source.type}-${source.id}`}>
                <TableCell className="px-4 font-medium">{source.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{sourceTypeLabel(source.type)}</Badge>
                </TableCell>
                <NumberCell value={source.sends} />
                <NumberCell value={source.delivered} />
                <TableCell className="text-right">{formatPercent(source.openRate)}</TableCell>
                <TableCell className="text-right">{formatPercent(source.clickRate)}</TableCell>
                <NumberCell value={source.bounces} />
                <TableCell className="px-4 text-right tabular-nums">
                  {source.unsubscribes.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {report.sources.length === 0 ? <NoReportData /> : null}
      </ReportTableCard>
    </>
  );
}

export function DealsReportView({
  report,
  search,
}: {
  report: DealsReport;
  search: ReportSearch;
}): ReactNode {
  const navigate = useNavigate();
  return (
    <>
      <div className="max-w-52">
        <FormNativeSelect
          label="通貨"
          name="reportCurrency"
          value={report.currency}
          onChange={(event) =>
            void navigate({
              to: "/reports",
              search: { ...search, currency: event.target.value },
            })
          }
        >
          {report.currencies.map((currency) => (
            <FormSelectOption key={currency} value={currency}>
              {currency}
            </FormSelectOption>
          ))}
        </FormNativeSelect>
      </div>
      <MetricGrid>
        <Metric label="作成" value={report.summary.created} />
        <Metric label="獲得" value={report.summary.won} />
        <Metric label="失注" value={report.summary.lost} />
        <Metric label="勝率" value={formatPercent(report.summary.winRate)} />
        <Metric
          label="獲得金額"
          value={formatMoney(report.summary.wonValue, report.currency)}
          icon={<CircleDollarSign />}
        />
        <Metric label="進行中金額" value={formatMoney(report.summary.openValue, report.currency)} />
      </MetricGrid>
      <TrendCard
        title="商談の推移"
        description="作成・獲得・失注になった商談数"
        data={report.trend}
        series={[
          { key: "created", label: "作成", color: "#3b82f6" },
          { key: "won", label: "獲得", color: "#10b981" },
          { key: "lost", label: "失注", color: "#ef4444" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <ReportTableCard title="担当者別セールスパフォーマンス">
          <Table>
            <TableCaption className="sr-only">担当者別商談レポート</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">担当者</TableHead>
                <TableHead className="text-right">作成</TableHead>
                <TableHead className="text-right">獲得</TableHead>
                <TableHead className="text-right">失注</TableHead>
                <TableHead className="text-right">進行中</TableHead>
                <TableHead className="px-4 text-right">獲得金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.owners.map((owner) => (
                <TableRow key={owner.id}>
                  <TableCell className="px-4 font-medium">{owner.name}</TableCell>
                  <NumberCell value={owner.created} />
                  <NumberCell value={owner.won} />
                  <NumberCell value={owner.lost} />
                  <NumberCell value={owner.openCount} />
                  <TableCell className="px-4 text-right tabular-nums">
                    {formatMoney(owner.wonValue, report.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.owners.length === 0 ? <NoReportData /> : null}
        </ReportTableCard>
        <Card>
          <CardHeader>
            <CardTitle>タスク概要</CardTitle>
            <CardDescription>現在の未完了と期間内の完了</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressRow
              label="未完了"
              value={report.summary.openTasks}
              maximum={Math.max(report.summary.openTasks, report.summary.completedTasks, 1)}
            />
            <ProgressRow
              label="期限超過"
              value={report.summary.overdueTasks}
              maximum={Math.max(report.summary.openTasks, 1)}
              destructive
            />
            <ProgressRow
              label="期間内に完了"
              value={report.summary.completedTasks}
              maximum={Math.max(report.summary.openTasks, report.summary.completedTasks, 1)}
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>商談フォーキャスト</CardTitle>
          <CardDescription>
            完了予定日が期間内にある進行中商談を、ステージ確度で加重
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.forecast.map((stage) => (
            <div key={stage.stageId} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="font-medium">{stage.stageName}</span>
                <Badge variant="secondary" className="ml-auto">
                  {stage.probability}%
                </Badge>
              </div>
              <p className="mt-3 text-lg font-medium tabular-nums">
                {formatMoney(stage.weightedValue, report.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {stage.dealCount.toLocaleString()}件・総額
                {formatMoney(stage.dealValue, report.currency)}
              </p>
            </div>
          ))}
          {report.forecast.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3">
              <NoReportData />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

export function SiteReportView({ report }: { report: SiteReport }): ReactNode {
  return (
    <>
      <MetricGrid>
        <Metric label="ページビュー" value={report.summary.pageViews} icon={<Globe2 />} />
        <Metric label="ユニーク訪問者" value={report.summary.uniqueVisitors} />
        <Metric
          label="特定済み率"
          value={formatPercent(report.summary.identificationRate)}
          icon={<UserCheck />}
        />
        <Metric label="フォーム送信" value={report.summary.submissions} />
        <Metric label="メッセージ表示" value={report.summary.messageImpressions} />
        <Metric label="メッセージクリック" value={report.summary.messageClicks} />
      </MetricGrid>
      <TrendCard
        title="サイトアクティビティ"
        description="ページビューとフォーム送信"
        data={report.trend}
        series={[
          { key: "pageViews", label: "ページビュー", color: "#3b82f6" },
          { key: "submissions", label: "フォーム送信", color: "#10b981" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ReportTableCard title="上位ページ">
          <Table>
            <TableCaption className="sr-only">ページ別サイトレポート</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">URL</TableHead>
                <TableHead className="text-right">PV</TableHead>
                <TableHead className="text-right">訪問者</TableHead>
                <TableHead className="px-4 text-right">特定済み</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.topPages.map((page) => (
                <TableRow key={page.url}>
                  <TableCell className="max-w-72 truncate px-4 font-medium" title={page.url}>
                    {page.url}
                  </TableCell>
                  <NumberCell value={page.views} />
                  <NumberCell value={page.uniqueVisitors} />
                  <TableCell className="px-4 text-right tabular-nums">
                    {page.identifiedContacts.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.topPages.length === 0 ? <NoReportData /> : null}
        </ReportTableCard>
        <ReportTableCard title="フォームパフォーマンス">
          <Table>
            <TableCaption className="sr-only">フォーム別レポート</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">フォーム</TableHead>
                <TableHead>状態</TableHead>
                <TableHead className="text-right">送信</TableHead>
                <TableHead className="px-4 text-right">連絡先</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell className="px-4 font-medium">{form.name}</TableCell>
                  <TableCell>
                    <ReportStatusBadge status={form.status} />
                  </TableCell>
                  <NumberCell value={form.submissions} />
                  <TableCell className="px-4 text-right tabular-nums">
                    {form.contacts.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.forms.length === 0 ? <NoReportData /> : null}
        </ReportTableCard>
      </div>
      <ReportTableCard title="サイトメッセージ（累計）">
        <Table>
          <TableCaption className="sr-only">サイトメッセージ別レポート</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">メッセージ</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">表示</TableHead>
              <TableHead className="text-right">クリック</TableHead>
              <TableHead className="px-4 text-right">クリック率</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.messages.map((message) => (
              <TableRow key={message.id}>
                <TableCell className="px-4 font-medium">{message.name}</TableCell>
                <TableCell>
                  <ReportStatusBadge status={message.status} />
                </TableCell>
                <NumberCell value={message.impressions} />
                <NumberCell value={message.clicks} />
                <TableCell className="px-4 text-right">
                  {formatPercent(message.clickRate)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {report.messages.length === 0 ? <NoReportData /> : null}
      </ReportTableCard>
    </>
  );
}

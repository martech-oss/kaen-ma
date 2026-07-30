import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleDollarSign,
  Download,
  GitBranch,
  Globe2,
  Mail,
  Send,
  TrendingUp,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type ReactNode } from "react";

import {
  EmptyState,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
} from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AutomationsReport,
  ContactsReport,
  DealsReport,
  EmailsReport,
  ReportSearch,
  ReportView,
  ReportWorkspace,
  SiteReport,
} from "@/features/reports/report-api";
import { getFormString } from "@/lib/utils";

const reportNavigation: Array<{
  view: ReportView;
  label: string;
  icon: typeof ChartNoAxesCombined;
}> = [
  { view: "overview", label: "概要", icon: ChartNoAxesCombined },
  { view: "contacts", label: "連絡先", icon: UsersRound },
  { view: "automations", label: "オートメーション", icon: GitBranch },
  { view: "emails", label: "メール", icon: Mail },
  { view: "deals", label: "商談", icon: BriefcaseBusiness },
  { view: "site", label: "サイト", icon: Globe2 },
];

export function ReportsPage({
  data,
  search,
}: {
  data: ReportWorkspace;
  search: ReportSearch;
}): ReactNode {
  const exportAction = reportExport(data);
  return (
    <PageLayout
      title="Reporting"
      action={
        exportAction ? (
          <Button
            variant="outline"
            onClick={() => exportCsv(exportAction.filename, exportAction.rows)}
          >
            <Download data-icon="inline-start" />
            CSVをエクスポート
          </Button>
        ) : undefined
      }
    >
      <ReportControls search={search} />
      {data.view === "overview" &&
      data.contacts &&
      data.automations &&
      data.emails &&
      data.deals &&
      data.site ? (
        <ReportsOverview
          search={search}
          contacts={data.contacts}
          automations={data.automations}
          emails={data.emails}
          deals={data.deals}
          site={data.site}
        />
      ) : null}
      {data.view === "contacts" && data.contacts ? (
        <ContactsReportView report={data.contacts} />
      ) : null}
      {data.view === "automations" && data.automations ? (
        <AutomationsReportView report={data.automations} />
      ) : null}
      {data.view === "emails" && data.emails ? <EmailsReportView report={data.emails} /> : null}
      {data.view === "deals" && data.deals ? (
        <DealsReportView report={data.deals} search={search} />
      ) : null}
      {data.view === "site" && data.site ? <SiteReportView report={data.site} /> : null}
    </PageLayout>
  );
}

function ReportControls({ search }: { search: ReportSearch }): ReactNode {
  const navigate = useNavigate();

  function applyRange(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void navigate({
      to: "/reports",
      search: {
        ...search,
        from: getFormString(form, "from"),
        to: getFormString(form, "to"),
      },
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="レポートカテゴリ">
          {reportNavigation.map((item) => (
            <Button
              key={item.view}
              variant={search.view === item.view ? "default" : "ghost"}
              nativeButton={false}
              render={
                <Link
                  to="/reports"
                  search={{
                    ...search,
                    view: item.view,
                  }}
                />
              }
            >
              <item.icon data-icon="inline-start" />
              {item.label}
            </Button>
          ))}
        </nav>
        <form
          className="flex flex-wrap items-end gap-3 border-t pt-4"
          onSubmit={applyRange}
          key={`${search.from}-${search.to}`}
        >
          <div className="min-w-44">
            <FormInput label="開始日" name="from" type="date" defaultValue={search.from} required />
          </div>
          <div className="min-w-44">
            <FormInput label="終了日" name="to" type="date" defaultValue={search.to} required />
          </div>
          <Button type="submit">期間を適用</Button>
          <span className="pb-1 text-xs text-muted-foreground">
            最大366日・終了日を含む期間で集計
          </span>
        </form>
      </CardContent>
    </Card>
  );
}

function ReportsOverview({
  search,
  contacts,
  automations,
  emails,
  deals,
  site,
}: {
  search: ReportSearch;
  contacts: ContactsReport;
  automations: AutomationsReport;
  emails: EmailsReport;
  deals: DealsReport;
  site: SiteReport;
}): ReactNode {
  const cards = [
    {
      view: "contacts" as const,
      title: "連絡先",
      icon: UsersRound,
      value: `${contacts.summary.newContacts.toLocaleString()}人`,
      label: "期間内の新規連絡先",
      detail: `現在のアクティブ ${contacts.summary.activeContacts.toLocaleString()}人`,
    },
    {
      view: "automations" as const,
      title: "オートメーション",
      icon: GitBranch,
      value: `${automations.summary.entries.toLocaleString()}件`,
      label: "フローへの参加",
      detail: `完了率 ${formatPercent(automations.summary.completionRate)}`,
    },
    {
      view: "emails" as const,
      title: "メール",
      icon: Mail,
      value: `${emails.summary.sends.toLocaleString()}通`,
      label: "メール送信",
      detail: `開封率 ${formatPercent(emails.summary.openRate)}`,
    },
    {
      view: "deals" as const,
      title: "商談",
      icon: BriefcaseBusiness,
      value: formatMoney(deals.summary.wonValue, deals.currency),
      label: "獲得金額",
      detail: `勝率 ${formatPercent(deals.summary.winRate)}`,
    },
    {
      view: "site" as const,
      title: "サイト",
      icon: Globe2,
      value: `${site.summary.pageViews.toLocaleString()}回`,
      label: "ページビュー",
      detail: `フォーム送信 ${site.summary.submissions.toLocaleString()}件`,
    },
  ];
  return (
    <>
      <section>
        <h2 className="mb-3 font-heading text-lg font-medium">パフォーマンス概要</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <Card key={card.view}>
              <CardHeader>
                <CardDescription>{card.title}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
                <CardAction>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted [&>svg]:size-4">
                    <card.icon />
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-sm">{card.detail}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/reports" search={{ ...search, view: card.view }} />}
                >
                  詳細を見る
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ファネルの状態</CardTitle>
            <CardDescription>顧客獲得から商談獲得までの主要指標</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressRow
              label="新規連絡先"
              value={contacts.summary.newContacts}
              maximum={Math.max(contacts.summary.newContacts, automations.summary.entries, 1)}
            />
            <ProgressRow
              label="オートメーション参加"
              value={automations.summary.entries}
              maximum={Math.max(contacts.summary.newContacts, automations.summary.entries, 1)}
            />
            <ProgressRow
              label="獲得商談"
              value={deals.summary.won}
              maximum={Math.max(contacts.summary.newContacts, automations.summary.entries, 1)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>注意が必要な指標</CardTitle>
            <CardDescription>運用上の確認候補</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <AttentionItem label="メールバウンス" value={emails.summary.bounces} />
            <AttentionItem label="配信停止" value={emails.summary.unsubscribes} />
            <AttentionItem label="期限超過タスク" value={deals.summary.overdueTasks} />
            <AttentionItem label="アーカイブ連絡先" value={contacts.summary.archivedContacts} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ContactsReportView({ report }: { report: ContactsReport }): ReactNode {
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

function AutomationsReportView({ report }: { report: AutomationsReport }): ReactNode {
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
                  <StatusBadge status={automation.status} />
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

function EmailsReportView({ report }: { report: EmailsReport }): ReactNode {
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

function DealsReportView({
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

function SiteReportView({ report }: { report: SiteReport }): ReactNode {
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
                    <StatusBadge status={form.status} />
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
                  <StatusBadge status={message.status} />
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

function MetricGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

function Metric({
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

function TrendCard({
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
  const maximum = Math.max(
    1,
    ...data.flatMap((row) => series.map((item) => Number(row[item.key] ?? 0))),
  );
  const interval = Math.max(1, Math.ceil(data.length / 8));
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
          <div className="overflow-x-auto">
            <div
              className="flex h-56 items-end gap-2 border-b pt-6"
              style={{ minWidth: `${Math.max(640, data.length * 34)}px` }}
            >
              {data.map((row, index) => (
                <div
                  key={String(row["day"])}
                  className="flex h-full min-w-6 flex-1 flex-col justify-end"
                  title={series
                    .map((item) => `${item.label}: ${Number(row[item.key] ?? 0).toLocaleString()}`)
                    .join(" / ")}
                >
                  <div className="flex h-44 items-end justify-center gap-px">
                    {series.map((item) => (
                      <div
                        key={item.key}
                        className="min-h-px flex-1 rounded-t-sm"
                        style={{
                          backgroundColor: item.color,
                          height: `${(Number(row[item.key] ?? 0) / maximum) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="mt-2 h-4 text-center text-[10px] text-muted-foreground">
                    {index % interval === 0 || index === data.length - 1
                      ? formatShortDate(String(row["day"]))
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RankingCard({
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

function ReportTableCard({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">{children}</CardContent>
    </Card>
  );
}

function NumberCell({ value }: { value: number }): ReactNode {
  return <TableCell className="text-right tabular-nums">{value.toLocaleString()}</TableCell>;
}

function StatusBadge({ status }: { status: string }): ReactNode {
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

function ProgressRow({
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

function AttentionItem({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-medium tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function NoReportData(): ReactNode {
  return (
    <EmptyState
      compact
      title="この期間のデータはありません"
      description="期間を変更するか、データが蓄積されてから確認してください。"
    />
  );
}

function reportExport(
  data: ReportWorkspace,
): { filename: string; rows: Array<Record<string, string | number>> } | null {
  if (data.view === "contacts" && data.contacts) {
    return {
      filename: "contacts-report.csv",
      rows: data.contacts.trend.map((row) => ({
        date: row.day,
        contacts_added: row.added,
        contacts_archived: row.archived,
      })),
    };
  }
  if (data.view === "automations" && data.automations) {
    return {
      filename: "automations-report.csv",
      rows: data.automations.automations.map((row) => ({
        automation: row.name,
        status: row.status,
        entries: row.entries,
        completions: row.completions,
        active_contacts: row.activeContacts,
        email_sends: row.sends,
        unique_opens: row.opens,
        unique_clicks: row.clicks,
      })),
    };
  }
  if (data.view === "emails" && data.emails) {
    return {
      filename: "emails-report.csv",
      rows: data.emails.sources.map((row) => ({
        source: row.name,
        type: row.type,
        sends: row.sends,
        delivered: row.delivered,
        opens: row.opens,
        clicks: row.clicks,
        bounces: row.bounces,
        unsubscribes: row.unsubscribes,
      })),
    };
  }
  if (data.view === "deals" && data.deals) {
    return {
      filename: "deals-report.csv",
      rows: data.deals.owners.map((row) => ({
        owner: row.name,
        currency: data.deals!.currency,
        created: row.created,
        won: row.won,
        lost: row.lost,
        open: row.openCount,
        won_value: row.wonValue,
      })),
    };
  }
  if (data.view === "site" && data.site) {
    return {
      filename: "site-report.csv",
      rows: data.site.topPages.map((row) => ({
        url: row.url,
        page_views: row.views,
        unique_visitors: row.uniqueVisitors,
        identified_contacts: row.identifiedContacts,
      })),
    };
  }
  return null;
}

function exportCsv(filename: string, rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sourceTypeLabel(type: string): string {
  if (type === "broadcast") return "一斉配信";
  if (type === "automation") return "オートメーション";
  return "Transactional";
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%`;
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(
    new Date(`${value}T00:00:00`),
  );
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

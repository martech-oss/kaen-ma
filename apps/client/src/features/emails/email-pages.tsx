import { CalendarClock, FileText, Plus, Send, UsersRound } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";

import { AppDialog, ErrorAlert, PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type EmailArchiveData,
  type EmailCampaignRow,
  type EmailCampaignsData,
  type EmailTemplateRow,
  type EmailTemplatesData,
  type EmailVariablesData,
  loadEmailArchive,
  loadEmailCampaigns,
  loadEmailTemplates,
  loadEmailVariables,
  type MessageVariableRow,
  type SegmentOption,
  type TopicOption,
} from "@/features/emails/email-api";

import { CampaignForm, TemplateForm, VariableForm } from "./email-forms";
import {
  ArchivedResources,
  CampaignTable,
  TemplateTable,
  VariableReference,
  VariableTable,
} from "./email-tables";

type EmailSection = "campaigns" | "templates" | "variables" | "archive";

export function EmailCampaignsPage({ data }: { data: EmailCampaignsData }): ReactNode {
  return <EmailCenterPage view="campaigns" data={data} />;
}

export function EmailTemplatesPage({ data }: { data: EmailTemplatesData }): ReactNode {
  return <EmailCenterPage view="templates" data={data} />;
}

export function EmailVariablesPage({ data }: { data: EmailVariablesData }): ReactNode {
  return <EmailCenterPage view="variables" data={data} />;
}

export function EmailArchivePage({ data }: { data: EmailArchiveData }): ReactNode {
  return <EmailCenterPage view="archive" data={data} />;
}

type EmailPageData =
  | EmailCampaignsData
  | EmailTemplatesData
  | EmailVariablesData
  | EmailArchiveData;

function EmailCenterPage({ view, data }: { view: EmailSection; data: EmailPageData }): ReactNode {
  const [campaigns, setCampaigns] = useState<EmailCampaignRow[]>(
    view === "campaigns" ? (data as EmailCampaignsData).campaigns : [],
  );
  const [templates, setTemplates] = useState<EmailTemplateRow[]>(
    view === "campaigns"
      ? (data as EmailCampaignsData).templates
      : view === "templates"
        ? (data as EmailTemplatesData).templates
        : [],
  );
  const [variables, setVariables] = useState<MessageVariableRow[]>(
    view === "templates"
      ? (data as EmailTemplatesData).variables
      : view === "variables"
        ? (data as EmailVariablesData).variables
        : [],
  );
  const [archivedCampaigns, setArchivedCampaigns] = useState<EmailCampaignRow[]>(
    view === "archive" ? (data as EmailArchiveData).campaigns : [],
  );
  const [archivedTemplates, setArchivedTemplates] = useState<EmailTemplateRow[]>(
    view === "archive" ? (data as EmailArchiveData).templates : [],
  );
  const [segments, setSegments] = useState<SegmentOption[]>(
    view === "campaigns" ? (data as EmailCampaignsData).segments : [],
  );
  const [topics, setTopics] = useState<TopicOption[]>(
    view === "campaigns" ? (data as EmailCampaignsData).topics : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaignRow | null>(null);
  const [editingVariable, setEditingVariable] = useState<MessageVariableRow | null>(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      if (view === "campaigns") {
        const result = await loadEmailCampaigns();
        setCampaigns(result.campaigns);
        setTemplates(result.templates);
        setSegments(result.segments);
        setTopics(result.topics);
      } else if (view === "templates") {
        const result = await loadEmailTemplates();
        setTemplates(result.templates);
        setVariables(result.variables);
      } else if (view === "variables") {
        const result = await loadEmailVariables();
        setVariables(result.variables);
      } else {
        const result = await loadEmailArchive();
        setArchivedCampaigns(result.campaigns);
        setArchivedTemplates(result.templates);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "メール情報を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [view]);

  const pageTitle = {
    campaigns: "メールキャンペーン",
    templates: "メールテンプレート",
    variables: "メッセージ変数",
    archive: "メールアーカイブ",
  }[view];

  const action =
    view === "campaigns" ? (
      <Button
        onClick={() => {
          setEditingCampaign(null);
          setShowCampaignForm(true);
        }}
      >
        <Plus data-icon="inline-start" />
        メールキャンペーン
      </Button>
    ) : view === "templates" ? (
      <Button onClick={() => setShowTemplateForm(true)}>
        <Plus data-icon="inline-start" />
        Resend Template
      </Button>
    ) : view === "variables" ? (
      <Button
        onClick={() => {
          setEditingVariable(null);
          setShowVariableForm(true);
        }}
      >
        <Plus data-icon="inline-start" />
        メッセージ変数
      </Button>
    ) : undefined;

  return (
    <PageLayout title={pageTitle} action={action}>
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}

      {view === "campaigns" ? (
        <>
          <EmailSummary campaigns={campaigns} templates={templates} />
          <CampaignTable
            items={campaigns}
            loading={loading}
            onEdit={(campaign) => {
              setEditingCampaign(campaign);
              setShowCampaignForm(true);
            }}
            onChanged={load}
          />
        </>
      ) : null}

      {view === "templates" ? (
        <>
          <TemplateTable items={templates} loading={loading} onChanged={load} />
          <VariableReference variables={variables} />
        </>
      ) : null}

      {view === "variables" ? (
        <>
          <VariableReference variables={variables} />
          <VariableTable
            items={variables}
            loading={loading}
            onEdit={(variable) => {
              setEditingVariable(variable);
              setShowVariableForm(true);
            }}
            onChanged={load}
          />
        </>
      ) : null}

      {view === "archive" ? (
        <ArchivedResources
          campaigns={archivedCampaigns}
          templates={archivedTemplates}
          loading={loading}
        />
      ) : null}

      <AppDialog
        open={showCampaignForm}
        onOpenChange={setShowCampaignForm}
        title={editingCampaign ? "メールキャンペーンを編集" : "メールキャンペーンを作成"}
        description="配信対象、テンプレート、送信タイミングを設定します。"
        className="sm:max-w-xl"
      >
        <CampaignForm
          campaign={editingCampaign}
          segments={segments}
          templates={templates.filter(
            (template) => template.purpose === "marketing" && template.sendable,
          )}
          topics={topics}
          onSaved={async () => {
            setShowCampaignForm(false);
            setEditingCampaign(null);
            await load();
          }}
        />
      </AppDialog>

      <AppDialog
        open={showTemplateForm}
        onOpenChange={setShowTemplateForm}
        title="Resend Templateを登録"
        description="Resendで作成・公開したテンプレートをKaenmaから利用できるようにします。"
        className="sm:max-w-xl"
      >
        <TemplateForm
          onSaved={async () => {
            setShowTemplateForm(false);
            await load();
          }}
        />
      </AppDialog>

      <AppDialog
        open={showVariableForm}
        onOpenChange={setShowVariableForm}
        title={editingVariable ? "メッセージ変数を編集" : "メッセージ変数を作成"}
        description="Resend Template内では MESSAGE_KEY の形式で登録します。"
      >
        <VariableForm
          variable={editingVariable}
          onSaved={async () => {
            setShowVariableForm(false);
            setEditingVariable(null);
            await load();
          }}
        />
      </AppDialog>
    </PageLayout>
  );
}

function EmailSummary({
  campaigns,
  templates,
}: {
  campaigns: EmailCampaignRow[];
  templates: EmailTemplateRow[];
}): ReactNode {
  const scheduled = campaigns.filter((item) => item.status === "scheduled").length;
  const sent = campaigns.reduce((total, item) => total + item.sent_count, 0);
  const delivered = campaigns.reduce((total, item) => total + item.delivered_count, 0);
  const cards = [
    {
      label: "稼働中・予約",
      value: scheduled + campaigns.filter((item) => item.status === "sending").length,
      description: "予約済みまたは送信中",
      icon: CalendarClock,
    },
    {
      label: "送信",
      value: sent,
      description: "現在のキャンペーン合計",
      icon: Send,
    },
    {
      label: "到達",
      value: delivered,
      description: sent > 0 ? `到達率 ${Math.round((delivered / sent) * 100)}%` : "配信後に集計",
      icon: UsersRound,
    },
    {
      label: "テンプレート",
      value: templates.length,
      description: "利用可能なテンプレート",
      icon: FileText,
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl">{card.value.toLocaleString()}</CardTitle>
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

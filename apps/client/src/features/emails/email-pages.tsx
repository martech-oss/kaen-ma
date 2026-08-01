import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CalendarClock, FileText, Plus, Send, UsersRound } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";

import { AppDialog, PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type EmailArchiveData,
  type EmailCampaignRow,
  type EmailCampaignsData,
  type EmailTemplateRow,
  type EmailTemplatesData,
  type EmailVariablesData,
  emailArchiveQueryOptions,
  emailCampaignsQueryOptions,
  emailQueryKey,
  emailTemplatesQueryOptions,
  emailVariablesQueryOptions,
  type MessageVariableRow,
} from "@/features/emails/email-api";

import { ArchivedResources } from "./email-archived-resources";
import { CampaignForm, TemplateForm, VariableForm } from "./email-forms";
import { CampaignTable, TemplateTable } from "./email-tables";
import { VariableReference, VariableTable } from "./email-variable-tables";

type EmailSection = "campaigns" | "templates" | "variables" | "archive";

export function EmailCampaignsPage(): ReactNode {
  const query = useSuspenseQuery(emailCampaignsQueryOptions());
  return <EmailCenterPage view="campaigns" data={query.data} loading={query.isFetching} />;
}

export function EmailTemplatesPage(): ReactNode {
  const query = useSuspenseQuery(emailTemplatesQueryOptions());
  return <EmailCenterPage view="templates" data={query.data} loading={query.isFetching} />;
}

export function EmailVariablesPage(): ReactNode {
  const query = useSuspenseQuery(emailVariablesQueryOptions());
  return <EmailCenterPage view="variables" data={query.data} loading={query.isFetching} />;
}

export function EmailArchivePage(): ReactNode {
  const query = useSuspenseQuery(emailArchiveQueryOptions());
  return <EmailCenterPage view="archive" data={query.data} loading={query.isFetching} />;
}

type EmailPageData =
  | EmailCampaignsData
  | EmailTemplatesData
  | EmailVariablesData
  | EmailArchiveData;

function EmailCenterPage({
  view,
  data,
  loading,
}: {
  view: EmailSection;
  data: EmailPageData;
  loading: boolean;
}): ReactNode {
  const queryClient = useQueryClient();
  const campaigns = view === "campaigns" ? (data as EmailCampaignsData).campaigns : [];
  const templates =
    view === "campaigns"
      ? (data as EmailCampaignsData).templates
      : view === "templates"
        ? (data as EmailTemplatesData).templates
        : [];
  const variables =
    view === "templates"
      ? (data as EmailTemplatesData).variables
      : view === "variables"
        ? (data as EmailVariablesData).variables
        : [];
  const archivedCampaigns = view === "archive" ? (data as EmailArchiveData).campaigns : [];
  const archivedTemplates = view === "archive" ? (data as EmailArchiveData).templates : [];
  const segments = view === "campaigns" ? (data as EmailCampaignsData).segments : [];
  const topics = view === "campaigns" ? (data as EmailCampaignsData).topics : [];
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaignRow | null>(null);
  const [editingVariable, setEditingVariable] = useState<MessageVariableRow | null>(null);

  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey: emailQueryKey }),
    [queryClient],
  );

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
            onChanged={reload}
          />
        </>
      ) : null}

      {view === "templates" ? (
        <>
          <TemplateTable items={templates} loading={loading} onChanged={reload} />
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
            onChanged={reload}
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
            await reload();
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
            await reload();
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
            await reload();
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
  const sent = campaigns.reduce((total, item) => total + item.sentCount, 0);
  const delivered = campaigns.reduce((total, item) => total + item.deliveredCount, 0);
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

import { useSuspenseQuery } from "@tanstack/react-query";
import { CalendarClock, FileText, Plus, Send, UsersRound } from "lucide-react";
import { type ReactNode, useState } from "react";

import { PageLayout } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  emailTemplateOptionsQueryOptions,
  segmentOptionsQueryOptions,
} from "@/features/automations/automation-api";
import {
  emailArchivedCampaignsQueryOptions,
  emailArchivedTemplatesQueryOptions,
  emailCampaignsListQueryOptions,
  type EmailCampaignRow,
  emailTopicOptionsQueryOptions,
  type EmailTemplateRow,
  emailVariablesListQueryOptions,
  type MessageVariableRow,
  type SegmentOption,
  type TopicOption,
} from "@/features/emails/email-api";

import { ArchivedResources } from "./email-archived-resources";
import { CampaignForm, TemplateForm, VariableForm } from "./email-forms";
import { CampaignTable, TemplateTable } from "./email-tables";
import { VariableReference, VariableTable } from "./email-variable-tables";

type EmailSection = "campaigns" | "templates" | "variables" | "archive";

export function EmailCampaignsPage(): ReactNode {
  const campaignsQuery = useSuspenseQuery(emailCampaignsListQueryOptions());
  const templatesQuery = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const segmentsQuery = useSuspenseQuery(segmentOptionsQueryOptions());
  const topicsQuery = useSuspenseQuery(emailTopicOptionsQueryOptions());
  return (
    <EmailCenterPage
      view="campaigns"
      campaigns={campaignsQuery.data}
      templates={templatesQuery.data}
      segments={segmentsQuery.data}
      topics={topicsQuery.data}
      loading={campaignsQuery.isFetching}
    />
  );
}

export function EmailTemplatesPage(): ReactNode {
  const templatesQuery = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const variablesQuery = useSuspenseQuery(emailVariablesListQueryOptions());
  return (
    <EmailCenterPage
      view="templates"
      templates={templatesQuery.data}
      variables={variablesQuery.data}
      loading={templatesQuery.isFetching}
    />
  );
}

export function EmailVariablesPage(): ReactNode {
  const variablesQuery = useSuspenseQuery(emailVariablesListQueryOptions());
  return (
    <EmailCenterPage
      view="variables"
      variables={variablesQuery.data}
      loading={variablesQuery.isFetching}
    />
  );
}

export function EmailArchivePage(): ReactNode {
  const campaignsQuery = useSuspenseQuery(emailArchivedCampaignsQueryOptions());
  const templatesQuery = useSuspenseQuery(emailArchivedTemplatesQueryOptions());
  return (
    <EmailCenterPage
      view="archive"
      archivedCampaigns={campaignsQuery.data}
      archivedTemplates={templatesQuery.data}
      loading={campaignsQuery.isFetching || templatesQuery.isFetching}
    />
  );
}

function EmailCenterPage({
  view,
  campaigns = [],
  templates = [],
  variables = [],
  archivedCampaigns = [],
  archivedTemplates = [],
  segments = [],
  topics = [],
  loading,
}: {
  view: EmailSection;
  campaigns?: EmailCampaignRow[];
  templates?: EmailTemplateRow[];
  variables?: MessageVariableRow[];
  archivedCampaigns?: EmailCampaignRow[];
  archivedTemplates?: EmailTemplateRow[];
  segments?: SegmentOption[];
  topics?: TopicOption[];
  loading: boolean;
}): ReactNode {
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaignRow | null>(null);
  const [editingVariable, setEditingVariable] = useState<MessageVariableRow | null>(null);

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
          />
        </>
      ) : null}

      {view === "templates" ? (
        <>
          <TemplateTable items={templates} loading={loading} />
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

      <CampaignForm
        open={showCampaignForm}
        onOpenChange={setShowCampaignForm}
        campaign={editingCampaign}
        segments={segments}
        templates={templates.filter(
          (template) => template.purpose === "marketing" && template.sendable,
        )}
        topics={topics}
        onSaved={() => {
          setShowCampaignForm(false);
          setEditingCampaign(null);
        }}
      />

      <TemplateForm
        open={showTemplateForm}
        onOpenChange={setShowTemplateForm}
        onSaved={() => {
          setShowTemplateForm(false);
        }}
      />

      <VariableForm
        open={showVariableForm}
        onOpenChange={setShowVariableForm}
        variable={editingVariable}
        onSaved={() => {
          setShowVariableForm(false);
          setEditingVariable(null);
        }}
      />
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

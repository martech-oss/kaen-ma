import type { ContentDocument } from "@kaenma/shared";
import { rpc } from "@/rpc";

export interface EmailCampaignRow {
  id: string;
  name: string;
  segment_id: string;
  template_version_id: string;
  topic_id: string | null;
  status: "draft" | "scheduled" | "sending" | "completed" | "cancelled";
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  segment_name: string;
  member_count: number;
  template_name: string;
  subject: string;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
}

export interface EmailTemplateRow {
  id: string;
  name: string;
  purpose: "marketing" | "transactional";
  status: "draft" | "published" | "archived";
  current_version_id: string;
  version: number;
  subject: string;
  preview_text: string;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplateDetail extends EmailTemplateRow {
  content_document: ContentDocument;
}

export interface MessageVariableRow {
  id: string;
  key: string;
  name: string;
  value: string;
  description: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentOption {
  id: string;
  name: string;
  member_count: number;
}

export interface TopicOption {
  id: string;
  name: string;
  is_default: number;
}

export interface EmailCampaignsData {
  campaigns: EmailCampaignRow[];
  templates: EmailTemplateRow[];
  segments: SegmentOption[];
  topics: TopicOption[];
}

export interface EmailTemplatesData {
  templates: EmailTemplateRow[];
  variables: MessageVariableRow[];
}

export interface EmailVariablesData {
  variables: MessageVariableRow[];
}

export interface EmailArchiveData {
  campaigns: EmailCampaignRow[];
  templates: EmailTemplateRow[];
}

export async function loadEmailCampaigns(
  signal?: AbortSignal,
): Promise<EmailCampaignsData> {
  const [campaigns, templates, segments, topics] = await Promise.all([
    rpc<EmailCampaignRow[]>("/broadcasts", { signal: signal ?? null }),
    rpc<EmailTemplateRow[]>("/email-templates", {
      signal: signal ?? null,
    }),
    rpc<SegmentOption[]>("/segments", { signal: signal ?? null }),
    rpc<TopicOption[]>("/subscription-topics", {
      signal: signal ?? null,
    }),
  ]);
  return {
    campaigns: campaigns.data,
    templates: templates.data,
    segments: segments.data,
    topics: topics.data,
  };
}

export async function loadEmailTemplates(
  signal?: AbortSignal,
): Promise<EmailTemplatesData> {
  const [templates, variables] = await Promise.all([
    rpc<EmailTemplateRow[]>("/email-templates", {
      signal: signal ?? null,
    }),
    rpc<MessageVariableRow[]>("/message-variables", {
      signal: signal ?? null,
    }),
  ]);
  return { templates: templates.data, variables: variables.data };
}

export async function loadEmailVariables(
  signal?: AbortSignal,
): Promise<EmailVariablesData> {
  const variables = await rpc<MessageVariableRow[]>("/message-variables", {
    signal: signal ?? null,
  });
  return { variables: variables.data };
}

export async function loadEmailArchive(
  signal?: AbortSignal,
): Promise<EmailArchiveData> {
  const [campaigns, templates] = await Promise.all([
    rpc<EmailCampaignRow[]>("/broadcasts?archived=true", {
      signal: signal ?? null,
    }),
    rpc<EmailTemplateRow[]>("/email-templates?archived=true", {
      signal: signal ?? null,
    }),
  ]);
  return { campaigns: campaigns.data, templates: templates.data };
}

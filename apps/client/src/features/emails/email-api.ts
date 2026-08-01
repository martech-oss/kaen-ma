import { queryOptions } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";
import type {
  BroadcastSegmentOption,
  EmailCampaign,
  EmailTemplate,
  MessageVariable,
  ResendTemplateVariable,
  SubscriptionTopicOption,
} from "@kaenma/orpc";

export type { EmailCampaign, EmailTemplate, MessageVariable, ResendTemplateVariable };

/** Retained aliases so the table and form components read the same. */
export type EmailCampaignRow = EmailCampaign;
export type EmailTemplateRow = EmailTemplate;
export type MessageVariableRow = MessageVariable;
export type SegmentOption = BroadcastSegmentOption;
export type TopicOption = SubscriptionTopicOption;

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

export const emailQueryKey = ["emails"] as const;

export function emailCampaignsQueryOptions() {
  return queryOptions({
    queryKey: [...emailQueryKey, "campaigns"],
    queryFn: ({ signal }) => loadEmailCampaigns(signal),
  });
}

export function emailTemplatesQueryOptions() {
  return queryOptions({
    queryKey: [...emailQueryKey, "templates"],
    queryFn: ({ signal }) => loadEmailTemplates(signal),
  });
}

export function emailVariablesQueryOptions() {
  return queryOptions({
    queryKey: [...emailQueryKey, "variables"],
    queryFn: ({ signal }) => loadEmailVariables(signal),
  });
}

export function emailArchiveQueryOptions() {
  return queryOptions({
    queryKey: [...emailQueryKey, "archive"],
    queryFn: ({ signal }) => loadEmailArchive(signal),
  });
}

export async function loadEmailCampaigns(signal?: AbortSignal): Promise<EmailCampaignsData> {
  const options = signal ? { signal } : undefined;
  const [campaigns, templates, segments, topics] = await Promise.all([
    orpc.emails.listCampaigns({ archived: false }, options),
    orpc.emails.listTemplates({ archived: false }, options),
    orpc.emails.listSegmentOptions(undefined, options),
    orpc.emails.listTopicOptions(undefined, options),
  ]);
  return { campaigns, templates, segments, topics };
}

export async function loadEmailTemplates(signal?: AbortSignal): Promise<EmailTemplatesData> {
  const options = signal ? { signal } : undefined;
  const [templates, variables] = await Promise.all([
    orpc.emails.listTemplates({ archived: false }, options),
    orpc.emails.listVariables({ archived: false }, options),
  ]);
  return { templates, variables };
}

export async function loadEmailVariables(signal?: AbortSignal): Promise<EmailVariablesData> {
  return {
    variables: await orpc.emails.listVariables(
      { archived: false },
      signal ? { signal } : undefined,
    ),
  };
}

export async function loadEmailArchive(signal?: AbortSignal): Promise<EmailArchiveData> {
  const options = signal ? { signal } : undefined;
  const [campaigns, templates] = await Promise.all([
    orpc.emails.listCampaigns({ archived: true }, options),
    orpc.emails.listTemplates({ archived: true }, options),
  ]);
  return { campaigns, templates };
}

import type {
  BroadcastSegmentOption,
  EmailCampaign,
  EmailTemplate,
  MessageVariable,
  SubscriptionTopicOption,
} from "@openengage/orpc";

import { orpcQuery } from "@/lib/orpc";

export type { EmailCampaign, EmailTemplate, MessageVariable };

/** Retained aliases so the table and form components read the same. */
export type EmailCampaignRow = EmailCampaign;
export type EmailTemplateRow = EmailTemplate;
export type MessageVariableRow = MessageVariable;
export type SegmentOption = BroadcastSegmentOption;
export type TopicOption = SubscriptionTopicOption;

export function emailCampaignsListQueryOptions() {
  return orpcQuery.emails.listCampaigns.queryOptions({ input: { archived: false } });
}

export function emailArchivedCampaignsQueryOptions() {
  return orpcQuery.emails.listCampaigns.queryOptions({ input: { archived: true } });
}

export function emailArchivedTemplatesQueryOptions() {
  return orpcQuery.emails.listTemplates.queryOptions({ input: { archived: true } });
}

export function emailVariablesListQueryOptions() {
  return orpcQuery.emails.listVariables.queryOptions({ input: { archived: false } });
}

export function emailTopicOptionsQueryOptions() {
  return orpcQuery.emails.listTopicOptions.queryOptions();
}

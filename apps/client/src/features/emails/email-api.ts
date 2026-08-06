import { orpcQuery } from "@/lib/orpc";
import type {
  EmailSegmentOption,
  EmailTemplate,
  MessageVariable,
  SubscriptionTopicOption,
} from "@openengage/core/messaging";

export type { EmailTemplate, MessageVariable };

/** Retained aliases so the table and form components read the same. */
export type EmailTemplateRow = EmailTemplate;
export type MessageVariableRow = MessageVariable;
export type SegmentOption = EmailSegmentOption;
export type TopicOption = SubscriptionTopicOption;

export function emailArchivedTemplatesQueryOptions() {
  return orpcQuery.emails.listTemplates.queryOptions({ input: { archived: true } });
}

export function emailVariablesListQueryOptions() {
  return orpcQuery.emails.listVariables.queryOptions({ input: { archived: false } });
}

export function emailTopicOptionsQueryOptions() {
  return orpcQuery.emails.listTopicOptions.queryOptions();
}

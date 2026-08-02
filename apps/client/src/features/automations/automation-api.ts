import { orpcQuery } from "@/lib/orpc";

export function automationsQueryOptions() {
  return orpcQuery.automations.list.queryOptions();
}

export function automationDraftQueryOptions(id: string) {
  return orpcQuery.automations.getDraft.queryOptions({ input: { id } });
}

/** Only marketing templates synced and ready to send are offered as a node's email action. */
export function emailTemplateOptionsQueryOptions() {
  return orpcQuery.emails.listTemplates.queryOptions({ input: { archived: false } });
}

export function formOptionsQueryOptions() {
  return orpcQuery.website.listForms.queryOptions();
}

export function segmentOptionsQueryOptions() {
  return orpcQuery.emails.listSegmentOptions.queryOptions();
}

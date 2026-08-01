import type { CampaignDefinition } from "@kaenma/shared";

export function campaignTrigger(
  config: Extract<CampaignDefinition["nodes"][number], { type: "source" }>["config"],
): { eventType: string | null; resourceId: string | null; inactivityDays: number | null } {
  switch (config.source) {
    case "contact_created":
      return { eventType: "contact_created", resourceId: null, inactivityDays: null };
    case "segment_joined":
      return { eventType: "segment_joined", resourceId: config.segmentId, inactivityDays: null };
    case "form_submitted":
      return { eventType: "form_submitted", resourceId: config.formId, inactivityDays: null };
    case "api_event":
      return { eventType: "custom_event", resourceId: config.eventName, inactivityDays: null };
    case "webhook_event":
      return { eventType: "webhook_event", resourceId: config.eventName, inactivityDays: null };
    case "contact_inactive":
      return { eventType: null, resourceId: null, inactivityDays: config.days };
  }
}

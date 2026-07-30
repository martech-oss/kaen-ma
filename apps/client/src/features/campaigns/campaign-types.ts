import { type CampaignDefinition } from "@kaenma/shared";

export interface CampaignRow {
  id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  trigger_source: string | null;
  enrollment_count: number;
  active_count: number;
  completed_count: number;
  updated_at: string;
}

export interface AutomationOptions {
  templates: EmailTemplateOption[];
  forms: Array<{ id: string; name: string }>;
  segments: Array<{ id: string; name: string }>;
}

export interface EmailTemplateOption {
  id: string;
  name: string;
  purpose: "transactional" | "marketing";
  subject: string | null;
  sendable: boolean;
}

export interface CampaignDraft {
  graph: CampaignDefinition;
  status: CampaignRow["status"];
}

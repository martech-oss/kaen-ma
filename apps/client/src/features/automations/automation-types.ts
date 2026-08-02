import type { AutomationDraft, AutomationRow } from "@kaenma/orpc";

export type { AutomationDraft, AutomationRow };

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

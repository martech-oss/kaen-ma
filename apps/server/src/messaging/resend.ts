import {
  PermanentChannelError,
  ResendTemplateAdapter,
  type ResendHostedTemplate,
  type ResendTemplateVariable,
} from "@kaenma/channels";

import type { RuntimeEnv } from "../env";

export interface TemplateVariableContext {
  contact?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
  message?: Record<string, unknown>;
  unsubscribeUrl?: string;
  preferenceUrl?: string;
  appName?: string;
  actionUrl?: string;
  inviterName?: string;
  organizationName?: string;
}

export function createResendTemplateAdapter(env: RuntimeEnv): ResendTemplateAdapter {
  if (!env.RESEND_MANAGEMENT_API_KEY) {
    throw new PermanentChannelError("RESEND_MANAGEMENT_API_KEY is not configured");
  }
  return new ResendTemplateAdapter({ apiKey: env.RESEND_MANAGEMENT_API_KEY });
}

export function templateCompatibilityError(
  template: ResendHostedTemplate,
  purpose: "marketing" | "transactional",
): string | null {
  if (template.status !== "published") return "Resend Templateが公開されていません";
  if (!template.subject?.trim()) return "Resend Templateに件名が設定されていません";
  if (
    purpose === "marketing" &&
    !template.variables.some((variable) => variable.key === "KAENMA_UNSUBSCRIBE_URL")
  ) {
    return "MarketingテンプレートにはKAENMA_UNSUBSCRIBE_URL変数が必要です";
  }
  const unsupported = template.variables.find(
    (variable) =>
      variable.fallbackValue === null && !isSupportedTemplateVariable(variable.key, purpose),
  );
  return unsupported ? `必須変数${unsupported.key}をKaenmaのデータから解決できません` : null;
}

export function resolveTemplateVariables(
  variables: ResendTemplateVariable[],
  context: TemplateVariableContext,
): Record<string, string | number> {
  const resolved: Record<string, string | number> = {};
  for (const variable of variables) {
    const raw = resolveRawVariable(variable.key, context);
    if (raw === undefined || raw === null || raw === "") {
      if (variable.fallbackValue !== null) continue;
      throw new PermanentChannelError(
        `Required Resend template variable is missing: ${variable.key}`,
      );
    }
    const value = normalizeVariableValue(variable, raw);
    resolved[variable.key] = value;
  }
  return resolved;
}

export function parseTemplateVariables(value: string): ResendTemplateVariable[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PermanentChannelError("Stored Resend template variables are invalid");
  }
  if (!Array.isArray(parsed)) {
    throw new PermanentChannelError("Stored Resend template variables are invalid");
  }
  const variables: ResendTemplateVariable[] = [];
  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      typeof Reflect.get(item, "key") !== "string" ||
      !["string", "number"].includes(String(Reflect.get(item, "type")))
    ) {
      throw new PermanentChannelError("Stored Resend template variables are invalid");
    }
    const fallbackValue = Reflect.get(item, "fallbackValue");
    variables.push({
      key: String(Reflect.get(item, "key")),
      type: Reflect.get(item, "type") === "number" ? "number" : "string",
      fallbackValue:
        typeof fallbackValue === "string" || typeof fallbackValue === "number"
          ? fallbackValue
          : null,
    });
  }
  return variables;
}

function isSupportedTemplateVariable(key: string, purpose: "marketing" | "transactional"): boolean {
  if (
    [
      "APP_NAME",
      "ACTION_URL",
      "INVITER_NAME",
      "ORGANIZATION_NAME",
      "CONTACT_EMAIL",
      "CONTACT_FIRST_NAME",
      "CONTACT_LAST_NAME",
      "CONTACT_PHONE",
      "CONTACT_STAGE",
      "CONTACT_SCORE",
    ].includes(key)
  ) {
    return true;
  }
  if (key === "KAENMA_UNSUBSCRIBE_URL" || key === "KAENMA_PREFERENCE_URL") {
    return purpose === "marketing";
  }
  return key.startsWith("CONTACT_CUSTOM_") || key.startsWith("MESSAGE_");
}

function resolveRawVariable(key: string, context: TemplateVariableContext): unknown {
  const builtIn: Record<string, unknown> = {
    APP_NAME: context.appName,
    ACTION_URL: context.actionUrl,
    INVITER_NAME: context.inviterName,
    ORGANIZATION_NAME: context.organizationName,
    CONTACT_EMAIL: context.contact?.["email"],
    CONTACT_FIRST_NAME: context.contact?.["first_name"],
    CONTACT_LAST_NAME: context.contact?.["last_name"],
    CONTACT_PHONE: context.contact?.["phone"],
    CONTACT_STAGE: context.contact?.["stage"],
    CONTACT_SCORE: context.contact?.["score"],
    KAENMA_UNSUBSCRIBE_URL: context.unsubscribeUrl,
    KAENMA_PREFERENCE_URL: context.preferenceUrl,
  };
  if (key in builtIn) return builtIn[key];
  if (key.startsWith("CONTACT_CUSTOM_")) {
    return lookupByNormalizedKey(context.customFields, key.slice("CONTACT_CUSTOM_".length));
  }
  if (key.startsWith("MESSAGE_")) {
    return lookupByNormalizedKey(context.message, key.slice("MESSAGE_".length));
  }
  return undefined;
}

function lookupByNormalizedKey(
  source: Record<string, unknown> | undefined,
  normalizedKey: string,
): unknown {
  if (!source) return undefined;
  const expected = normalizedKey.toLowerCase();
  const entry = Object.entries(source).find(
    ([key]) => key.replaceAll(/[^A-Za-z0-9]+/g, "_").toLowerCase() === expected,
  );
  return entry?.[1];
}

function normalizeVariableValue(variable: ResendTemplateVariable, raw: unknown): string | number {
  if (variable.type === "number") {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new PermanentChannelError(`Resend template variable must be a number: ${variable.key}`);
    }
    return value;
  }
  if (!["string", "number", "boolean"].includes(typeof raw)) {
    throw new PermanentChannelError(`Resend template variable must be scalar: ${variable.key}`);
  }
  const value = String(raw);
  if (value.length > 2_000) {
    throw new PermanentChannelError(`Resend template variable is too long: ${variable.key}`);
  }
  return value;
}

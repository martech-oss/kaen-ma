import { PermanentChannelError, type ResendHostedTemplate } from "@openengage/channels";
import { describe, expect, it } from "vitest";

import {
  parseTemplateVariables,
  resolveTemplateVariables,
  templateCompatibilityError,
} from "./resend";

const publishedTemplate: ResendHostedTemplate = {
  id: "template-id",
  alias: "welcome",
  name: "Welcome",
  subject: "Welcome",
  status: "published",
  currentVersionId: "version-id",
  hasUnpublishedVersions: false,
  publishedAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
  variables: [],
};

describe("Resend hosted template compatibility", () => {
  it("requires OpenEngage's unsubscribe URL for marketing templates", () => {
    expect(templateCompatibilityError(publishedTemplate, "marketing")).toContain(
      "OPENENGAGE_UNSUBSCRIBE_URL",
    );
    expect(templateCompatibilityError(publishedTemplate, "transactional")).toBeNull();
  });

  it("rejects unsupported required variables but allows fallback variables", () => {
    expect(
      templateCompatibilityError(
        {
          ...publishedTemplate,
          variables: [{ key: "UNKNOWN", type: "string", fallbackValue: null }],
        },
        "transactional",
      ),
    ).toContain("UNKNOWN");
    expect(
      templateCompatibilityError(
        {
          ...publishedTemplate,
          variables: [{ key: "UNKNOWN", type: "string", fallbackValue: "fallback" }],
        },
        "transactional",
      ),
    ).toBeNull();
  });
});

describe("Resend hosted template variables", () => {
  it("resolves contact, custom, message, and consent variables", () => {
    const variables = [
      { key: "CONTACT_EMAIL", type: "string", fallbackValue: null },
      { key: "CONTACT_CUSTOM_PLAN_NAME", type: "string", fallbackValue: null },
      { key: "MESSAGE_BRAND_NAME", type: "string", fallbackValue: null },
      { key: "CONTACT_SCORE", type: "number", fallbackValue: null },
      { key: "OPENENGAGE_UNSUBSCRIBE_URL", type: "string", fallbackValue: null },
    ] as const;

    expect(
      resolveTemplateVariables([...variables], {
        contact: { email: "person@example.com", score: "12" },
        customFields: { plan_name: "Pro" },
        message: { brand_name: "OpenEngage" },
        unsubscribeUrl: "https://example.com/u/token",
      }),
    ).toEqual({
      CONTACT_EMAIL: "person@example.com",
      CONTACT_CUSTOM_PLAN_NAME: "Pro",
      MESSAGE_BRAND_NAME: "OpenEngage",
      CONTACT_SCORE: 12,
      OPENENGAGE_UNSUBSCRIBE_URL: "https://example.com/u/token",
    });
  });

  it("omits missing variables with a Resend fallback and rejects missing required variables", () => {
    expect(
      resolveTemplateVariables(
        [{ key: "CONTACT_FIRST_NAME", type: "string", fallbackValue: "there" }],
        {},
      ),
    ).toEqual({});
    expect(() =>
      resolveTemplateVariables(
        [{ key: "CONTACT_FIRST_NAME", type: "string", fallbackValue: null }],
        {},
      ),
    ).toThrow(PermanentChannelError);
  });

  it("validates persisted variable metadata", () => {
    expect(
      parseTemplateVariables(
        JSON.stringify([{ key: "CONTACT_SCORE", type: "number", fallbackValue: 0 }]),
      ),
    ).toEqual([{ key: "CONTACT_SCORE", type: "number", fallbackValue: 0 }]);
    expect(() => parseTemplateVariables("{}")).toThrow(PermanentChannelError);
  });
});

import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { describe, expect, it } from "vitest";

import {
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  PasswordResetEmail,
  renderSystemEmail,
  type SystemEmailInput,
} from "./index";

describe("system email templates", () => {
  it.each([
    [
      "password reset",
      createElement(PasswordResetEmail, {
        appName: "OpenEngage",
        actionUrl: "https://example.com/reset",
      }),
    ],
    [
      "email verification",
      createElement(EmailVerificationEmail, {
        appName: "OpenEngage",
        actionUrl: "https://example.com/verify",
      }),
    ],
    [
      "organization invitation",
      createElement(OrganizationInvitationEmail, {
        appName: "OpenEngage",
        actionUrl: "https://example.com/invite",
        inviterName: "Ada",
        organizationName: "Analytical Engine",
      }),
    ],
  ])("renders %s as HTML and plain text", async (_name, template) => {
    const html = await render(template);
    const text = toPlainText(html);

    expect(html).toContain("<!DOCTYPE");
    expect(html).toContain("https://example.com/");
    expect(text).toContain("https://example.com/");
  });

  it.each([
    {
      kind: "password-reset",
      appName: "OpenEngage",
      actionUrl: "https://example.com/reset",
    },
    {
      kind: "email-verification",
      appName: "OpenEngage",
      actionUrl: "https://example.com/verify",
    },
    {
      kind: "organization-invitation",
      appName: "OpenEngage",
      actionUrl: "https://example.com/invite",
      inviterName: "Ada",
      organizationName: "Analytical Engine",
    },
  ] satisfies SystemEmailInput[])("renders $kind for direct binding delivery", async (input) => {
    const rendered = await renderSystemEmail(input);
    expect(rendered.subject).not.toBe("");
    expect(rendered.html).toContain("<!DOCTYPE");
    expect(rendered.html).toContain(input.actionUrl);
    expect(rendered.text).toContain(input.actionUrl);
  });
});

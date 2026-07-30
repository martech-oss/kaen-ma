import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { describe, expect, it } from "vitest";

import { EmailVerificationEmail, OrganizationInvitationEmail, PasswordResetEmail } from "./index";

describe("system email templates", () => {
  it.each([
    [
      "password reset",
      createElement(PasswordResetEmail, {
        appName: "Kaenma",
        actionUrl: "https://example.com/reset",
      }),
    ],
    [
      "email verification",
      createElement(EmailVerificationEmail, {
        appName: "Kaenma",
        actionUrl: "https://example.com/verify",
      }),
    ],
    [
      "organization invitation",
      createElement(OrganizationInvitationEmail, {
        appName: "Kaenma",
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
});

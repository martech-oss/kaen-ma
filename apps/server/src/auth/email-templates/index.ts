import { createElement } from "react";
import { render, toPlainText } from "react-email";

import { EmailVerificationEmail } from "./email-verification";
import { OrganizationInvitationEmail } from "./organization-invitation";
import { PasswordResetEmail } from "./password-reset";

export { EmailVerificationEmail, type EmailVerificationEmailProps } from "./email-verification";
export {
  OrganizationInvitationEmail,
  type OrganizationInvitationEmailProps,
} from "./organization-invitation";
export { PasswordResetEmail, type PasswordResetEmailProps } from "./password-reset";

export type SystemEmailInput =
  | { kind: "password-reset"; appName: string; actionUrl: string }
  | { kind: "email-verification"; appName: string; actionUrl: string }
  | {
      kind: "organization-invitation";
      appName: string;
      actionUrl: string;
      inviterName: string;
      organizationName: string;
    };

export interface RenderedSystemEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderSystemEmail(input: SystemEmailInput): Promise<RenderedSystemEmail> {
  const template =
    input.kind === "password-reset"
      ? createElement(PasswordResetEmail, input)
      : input.kind === "email-verification"
        ? createElement(EmailVerificationEmail, input)
        : createElement(OrganizationInvitationEmail, input);
  const subject =
    input.kind === "password-reset"
      ? `${input.appName}のパスワード再設定`
      : input.kind === "email-verification"
        ? `${input.appName}のメールアドレス確認`
        : `${input.organizationName}への招待`;
  const html = await render(template);
  return { subject, html, text: toPlainText(html) };
}

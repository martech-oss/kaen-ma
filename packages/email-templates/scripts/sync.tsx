import type { ReactElement } from "react";
import { Resend, type ErrorResponse } from "resend";

import { EmailVerificationEmail } from "../src/email-verification";
import { OrganizationInvitationEmail } from "../src/organization-invitation";
import { PasswordResetEmail } from "../src/password-reset";

interface SystemTemplate {
  alias: string;
  name: string;
  subject: string;
  react: ReactElement;
  variables: Array<{
    key: string;
    type: "string";
  }>;
}

const apiKey = process.env["RESEND_MANAGEMENT_API_KEY"];
if (!apiKey) {
  throw new Error("RESEND_MANAGEMENT_API_KEY is required");
}

const resend = new Resend(apiKey);
const templates: SystemTemplate[] = [
  {
    alias: "openengage-password-reset",
    name: "OpenEngage Password Reset",
    subject: "{{{APP_NAME}}}のパスワードを再設定",
    react: <PasswordResetEmail />,
    variables: [
      { key: "APP_NAME", type: "string" },
      { key: "ACTION_URL", type: "string" },
    ],
  },
  {
    alias: "openengage-email-verification",
    name: "OpenEngage Email Verification",
    subject: "{{{APP_NAME}}}のメールアドレスを確認",
    react: <EmailVerificationEmail />,
    variables: [
      { key: "APP_NAME", type: "string" },
      { key: "ACTION_URL", type: "string" },
    ],
  },
  {
    alias: "openengage-organization-invitation",
    name: "OpenEngage Organization Invitation",
    subject: "{{{ORGANIZATION_NAME}}}への招待",
    react: <OrganizationInvitationEmail />,
    variables: [
      { key: "APP_NAME", type: "string" },
      { key: "ACTION_URL", type: "string" },
      { key: "INVITER_NAME", type: "string" },
      { key: "ORGANIZATION_NAME", type: "string" },
    ],
  },
];

for (const template of templates) {
  const existing = await resend.templates.get(template.alias);
  let id = existing.data?.id;
  if (existing.error && existing.error.statusCode !== 404) {
    throwResendError(existing.error);
  }

  if (id) {
    const updated = await resend.templates.update(id, template);
    if (updated.error) throwResendError(updated.error);
  } else {
    const created = await resend.templates.create(template);
    if (created.error) throwResendError(created.error);
    if (!created.data?.id) throw new Error(`Resend did not return an ID for ${template.alias}`);
    id = created.data.id;
  }

  const published = await resend.templates.publish(id);
  if (published.error) throwResendError(published.error);
  console.info(`Published ${template.alias} (${id})`);
}

function throwResendError(error: ErrorResponse): never {
  throw new Error(`${error.name}: ${error.message}`);
}

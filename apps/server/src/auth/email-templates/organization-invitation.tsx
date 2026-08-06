import { Text } from "react-email";

import { SystemEmailLayout } from "./layout";

export interface OrganizationInvitationEmailProps {
  appName?: string;
  actionUrl?: string;
  inviterName?: string;
  organizationName?: string;
}

export function OrganizationInvitationEmail({
  appName = "{{{APP_NAME}}}",
  actionUrl = "{{{ACTION_URL}}}",
  inviterName = "{{{INVITER_NAME}}}",
  organizationName = "{{{ORGANIZATION_NAME}}}",
}: OrganizationInvitationEmailProps) {
  return (
    <SystemEmailLayout
      appName={appName}
      preview={`${organizationName}への招待が届いています`}
      title={`${organizationName}への招待`}
      description={
        <Text style={{ fontSize: "15px", lineHeight: "1.8" }}>
          {inviterName}さんから{organizationName}へ招待されました。
        </Text>
      }
      actionLabel="招待を確認"
      actionUrl={actionUrl}
    />
  );
}

export default OrganizationInvitationEmail;

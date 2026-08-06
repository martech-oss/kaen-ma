import { Text } from "react-email";

import { SystemEmailLayout } from "./layout";

export interface EmailVerificationEmailProps {
  appName?: string;
  actionUrl?: string;
}

export function EmailVerificationEmail({
  appName = "{{{APP_NAME}}}",
  actionUrl = "{{{ACTION_URL}}}",
}: EmailVerificationEmailProps) {
  return (
    <SystemEmailLayout
      appName={appName}
      preview={`${appName}のメールアドレスを確認してください`}
      title="メールアドレスの確認"
      description={
        <Text style={{ fontSize: "15px", lineHeight: "1.8" }}>
          アカウントの利用を開始するため、メールアドレスの確認を完了してください。
        </Text>
      }
      actionLabel="メールアドレスを確認"
      actionUrl={actionUrl}
    />
  );
}

export default EmailVerificationEmail;

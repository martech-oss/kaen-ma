import { Text } from "react-email";

import { SystemEmailLayout } from "./layout";

export interface PasswordResetEmailProps {
  appName?: string;
  actionUrl?: string;
}

export function PasswordResetEmail({
  appName = "{{{APP_NAME}}}",
  actionUrl = "{{{ACTION_URL}}}",
}: PasswordResetEmailProps) {
  return (
    <SystemEmailLayout
      appName={appName}
      preview={`${appName}のパスワードを再設定します`}
      title="パスワードの再設定"
      description={
        <Text style={{ fontSize: "15px", lineHeight: "1.8" }}>
          パスワード再設定のリクエストを受け付けました。心当たりがない場合は、このメールを無視してください。
        </Text>
      }
      actionLabel="パスワードを再設定"
      actionUrl={actionUrl}
    />
  );
}

export default PasswordResetEmail;

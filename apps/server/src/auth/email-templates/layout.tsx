import type { ReactNode } from "react";
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "react-email";

export interface SystemEmailLayoutProps {
  appName: string;
  preview: string;
  title: string;
  description: ReactNode;
  actionLabel: string;
  actionUrl: string;
}

export function SystemEmailLayout({
  appName,
  preview,
  title,
  description,
  actionLabel,
  actionUrl,
}: SystemEmailLayoutProps): ReactNode {
  return (
    <Html lang="ja">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>{appName}</Text>
          <Heading style={heading}>{title}</Heading>
          <Section>{description}</Section>
          <Button href={actionUrl} style={button}>
            {actionLabel}
          </Button>
          <Text style={hint}>
            ボタンを利用できない場合は、次のURLをブラウザへ貼り付けてください。
          </Text>
          <Text style={url}>{actionUrl}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  margin: "0",
  backgroundColor: "#f4f5f7",
  color: "#171717",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
};

const container = {
  margin: "40px auto",
  maxWidth: "560px",
  borderRadius: "12px",
  backgroundColor: "#ffffff",
  padding: "32px",
};

const brand = {
  margin: "0 0 28px",
  color: "#6d4aff",
  fontSize: "18px",
  fontWeight: "700",
};

const heading = {
  margin: "0 0 20px",
  fontSize: "26px",
  lineHeight: "1.4",
};

const button = {
  margin: "20px 0",
  borderRadius: "8px",
  backgroundColor: "#6d4aff",
  color: "#ffffff",
  padding: "12px 20px",
  fontWeight: "700",
  textDecoration: "none",
};

const hint = {
  margin: "24px 0 8px",
  color: "#64748b",
  fontSize: "13px",
  lineHeight: "1.6",
};

const url = {
  margin: "0",
  color: "#475569",
  fontSize: "12px",
  lineHeight: "1.6",
  wordBreak: "break-all" as const,
};

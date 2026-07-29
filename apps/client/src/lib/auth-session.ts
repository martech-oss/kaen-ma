import { authClient } from "@/auth-client";

export async function getCurrentSession() {
  const result = await authClient.getSession();
  return result.data ?? null;
}

export function safeRedirectTarget(value: unknown): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  ) {
    return value;
  }
  return "/dashboard";
}

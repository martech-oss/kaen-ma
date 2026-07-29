import { describe, expect, it } from "vitest";

import { safeRedirectTarget } from "@/lib/auth-session";

describe("safeRedirectTarget", () => {
  it("keeps internal paths", () => {
    expect(safeRedirectTarget("/contacts?q=test")).toBe("/contacts?q=test");
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeRedirectTarget("https://example.com")).toBe("/dashboard");
    expect(safeRedirectTarget("//example.com")).toBe("/dashboard");
  });
});

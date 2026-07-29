import { describe, expect, it } from "vitest";
import {
  adminRequestInputSchema,
  contactListInputSchema,
  contactListResultSchema,
  workspaceSchema,
} from "./index";

describe("oRPC contract schemas", () => {
  it("accepts contact search input", () => {
    expect(
      contactListInputSchema.parse({
        limit: 100,
        status: "active",
        sort: "updatedAt",
        direction: "desc",
      }),
    ).toEqual({
      limit: 100,
      status: "active",
      sort: "updatedAt",
      direction: "desc",
    });
  });

  it("rejects invalid contact list output", () => {
    expect(() =>
      contactListResultSchema.parse({ items: [], total: -1 }),
    ).toThrow();
  });

  it("validates workspace roles", () => {
    expect(
      workspaceSchema.parse({
        id: "workspace-id",
        name: "Kaenma",
        slug: "kaenma",
        logo: null,
        timezone: "Asia/Tokyo",
        created_at: Date.now(),
        role: "owner",
      }).role,
    ).toBe("owner");
  });

  it("accepts only internal admin API paths", () => {
    expect(
      adminRequestInputSchema.parse({
        path: "/email-templates?archived=true",
        method: "GET",
      }),
    ).toEqual({
      path: "/email-templates?archived=true",
      method: "GET",
    });

    for (const path of [
      "https://example.com/api",
      "//example.com/api",
      "/contacts/../api/auth/session",
      "/%2e%2e/api/auth/session",
      "/api/auth/session",
      "/auth/session",
    ]) {
      expect(() =>
        adminRequestInputSchema.parse({ path, method: "GET" }),
      ).toThrow();
    }
  });
});

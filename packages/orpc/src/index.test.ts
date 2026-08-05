import { describe, expect, it } from "vitest";

import { contactListInputSchema, contactListResultSchema, workspaceSchema } from "./index";

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
    expect(() => contactListResultSchema.parse({ items: [], total: -1 })).toThrow();
  });

  it("validates workspace roles", () => {
    expect(
      workspaceSchema.parse({
        id: "workspace-id",
        name: "OpenEngage",
        slug: "openengage",
        logo: null,
        timezone: "Asia/Tokyo",
        created_at: Date.now(),
        role: "owner",
      }).role,
    ).toBe("owner");
  });
});

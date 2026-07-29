import { describe, expect, it } from "vitest";

import {
  buildContactSearchInput,
  contactSearchDefaults,
  contactsQueryOptions,
  parseContactSearch,
} from "@/features/contacts/contact-api";

describe("contact search params", () => {
  it("normalizes malformed values to safe defaults", () => {
    expect(
      parseContactSearch({
        status: "deleted",
        sort: "unknown",
        direction: "sideways",
        q: 42,
      }),
    ).toEqual(contactSearchDefaults);
  });

  it("builds API params without empty optional filters", () => {
    const input = buildContactSearchInput({
      ...contactSearchDefaults,
      q: "  jane@example.com  ",
      tagId: "tag-1",
      scoreMin: "10",
      direction: "asc",
    });

    expect(input).toEqual({
      limit: 100,
      status: "active",
      sort: "updatedAt",
      direction: "asc",
      query: "jane@example.com",
      tagId: "tag-1",
      scoreMin: 10,
    });
  });

  it("creates stable, input-aware query keys", () => {
    const first = contactsQueryOptions({
      ...contactSearchDefaults,
      q: "jane@example.com",
    }).queryKey;
    const same = contactsQueryOptions({
      ...contactSearchDefaults,
      q: "jane@example.com",
    }).queryKey;
    const different = contactsQueryOptions({
      ...contactSearchDefaults,
      q: "john@example.com",
    }).queryKey;

    expect(first).toEqual(same);
    expect(first).not.toEqual(different);
  });
});

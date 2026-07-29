import { describe, expect, it } from "vitest";
import {
  buildContactSearchParams,
  contactSearchDefaults,
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
    const params = buildContactSearchParams({
      ...contactSearchDefaults,
      q: "  jane@example.com  ",
      tagId: "tag-1",
      direction: "asc",
    });

    expect(params.get("q")).toBe("jane@example.com");
    expect(params.get("tagId")).toBe("tag-1");
    expect(params.get("direction")).toBe("asc");
    expect(params.has("stage")).toBe(false);
  });
});

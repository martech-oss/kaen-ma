import { describe, expect, it } from "vitest";

import { createSegmentFilter } from "./segment-filter";

const emptyInput = {
  q: "",
  status: "all" as const,
  stage: "",
  tagId: "",
  listId: "",
  accountId: "",
  scoreMin: "",
  scoreMax: "",
};

const resources = {
  tags: [{ id: "tag-1", slug: "customer" }],
  lists: [{ id: "list-1", slug: "newsletter" }],
  companies: [{ id: "account-1", name: "Kaenma" }],
};

describe("createSegmentFilter", () => {
  it("returns null without active filters", () => {
    expect(createSegmentFilter(emptyInput, resources)).toBeNull();
  });

  it("creates a single condition without an unnecessary group", () => {
    expect(createSegmentFilter({ ...emptyInput, stage: "lead" }, resources)).toEqual({
      kind: "condition",
      field: "stage",
      operator: "eq",
      value: "lead",
    });
  });

  it("maps a text query to searchable contact fields", () => {
    expect(createSegmentFilter({ ...emptyInput, q: "  ada  " }, resources)).toEqual({
      kind: "group",
      combinator: "or",
      children: ["email", "first_name", "last_name"].map((field) => ({
        kind: "condition",
        field,
        operator: "contains",
        value: "ada",
      })),
    });
  });

  it("resolves resource IDs to stable segment values", () => {
    expect(
      createSegmentFilter(
        {
          ...emptyInput,
          tagId: "tag-1",
          listId: "list-1",
          accountId: "account-1",
          scoreMin: "10",
        },
        resources,
      ),
    ).toEqual({
      kind: "group",
      combinator: "and",
      children: [
        { kind: "condition", field: "score", operator: "gte", value: 10 },
        { kind: "condition", field: "tag", operator: "eq", value: "customer" },
        { kind: "condition", field: "list", operator: "eq", value: "newsletter" },
        { kind: "condition", field: "company", operator: "eq", value: "Kaenma" },
      ],
    });
  });

  it("ignores resource IDs that are not in the available options", () => {
    expect(createSegmentFilter({ ...emptyInput, tagId: "missing" }, resources)).toBeNull();
  });
});

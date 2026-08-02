import type { SegmentFilter } from "@kaenma/orpc";

import type { ContactSearch } from "./contact-api";

type SegmentCondition = Extract<SegmentFilter, { kind: "condition" }>;

type SegmentFilterInput = Pick<
  ContactSearch,
  "q" | "status" | "stage" | "tagId" | "companyId" | "scoreMin" | "scoreMax"
>;

interface SegmentFilterResources {
  tags: ReadonlyArray<{ id: string; slug: string }>;
  companies: ReadonlyArray<{ id: string; name: string }>;
}

/** Converts the currently visible contact filters into a reusable dynamic segment. */
export function createSegmentFilter(
  input: SegmentFilterInput,
  resources: SegmentFilterResources,
): SegmentFilter | null {
  const children: SegmentFilter[] = [];
  const query = input.q.trim();

  if (query) {
    children.push({
      kind: "group",
      combinator: "or",
      children: (["email", "first_name", "last_name"] as const).map((field) => ({
        kind: "condition" as const,
        field,
        operator: "contains" as const,
        value: query,
      })),
    });
  }

  if (input.status !== "all") {
    children.push({ kind: "condition", field: "status", operator: "eq", value: input.status });
  }
  addTextCondition(children, "stage", input.stage);
  addNumberCondition(children, "score", "gte", input.scoreMin);
  addNumberCondition(children, "score", "lte", input.scoreMax);

  const tag = resources.tags.find((item) => item.id === input.tagId);
  addTextCondition(children, "tag", tag?.slug);

  const company = resources.companies.find((item) => item.id === input.companyId);
  addTextCondition(children, "company", company?.name);

  if (children.length === 0) return null;
  return children.length === 1 ? children[0]! : { kind: "group", combinator: "and", children };
}

function addTextCondition(
  children: SegmentFilter[],
  field: SegmentCondition["field"],
  value: string | undefined,
): void {
  if (value) children.push({ kind: "condition", field, operator: "eq", value });
}

function addNumberCondition(
  children: SegmentFilter[],
  field: SegmentCondition["field"],
  operator: "gte" | "lte",
  value: string,
): void {
  if (!value) return;
  children.push({ kind: "condition", field, operator, value: Number(value) });
}

import { queryOptions } from "@tanstack/react-query";

import { orpc, orpcQuery } from "@/lib/orpc";
import type { ContactListInput } from "@kaenma/orpc";
import type {
  AccountOption,
  ContactList as ListOption,
  ContactOptions,
  SegmentOption,
  Tag as TagOption,
} from "@kaenma/orpc";

export type { AccountOption, ContactOptions, ListOption, SegmentOption, TagOption };

export const contactOptionsQueryKey = ["contacts", "options"] as const;

export type ContactStatus = "active" | "archived" | "anonymous" | "all";
export type ContactSort = "updatedAt" | "createdAt" | "score" | "name" | "email";

export interface ContactSearch {
  q: string;
  status: ContactStatus;
  stage: string;
  tagId: string;
  listId: string;
  accountId: string;
  segmentId: string;
  scoreMin: string;
  scoreMax: string;
  sort: ContactSort;
  direction: "asc" | "desc";
}

export const contactSearchDefaults: ContactSearch = {
  q: "",
  status: "active",
  stage: "",
  tagId: "",
  listId: "",
  accountId: "",
  segmentId: "",
  scoreMin: "",
  scoreMax: "",
  sort: "updatedAt",
  direction: "desc",
};

const contactStatuses = new Set<ContactStatus>(["active", "archived", "anonymous", "all"]);
const contactSorts = new Set<ContactSort>(["updatedAt", "createdAt", "score", "name", "email"]);

export function parseContactSearch(search: Record<string, unknown>): ContactSearch {
  const status =
    typeof search.status === "string" && contactStatuses.has(search.status as ContactStatus)
      ? (search.status as ContactStatus)
      : contactSearchDefaults.status;
  const sort =
    typeof search.sort === "string" && contactSorts.has(search.sort as ContactSort)
      ? (search.sort as ContactSort)
      : contactSearchDefaults.sort;
  const direction = search.direction === "asc" ? "asc" : "desc";
  const stringValue = (key: keyof ContactSearch): string =>
    typeof search[key] === "string" ? search[key] : "";

  return {
    q: stringValue("q"),
    status,
    stage: stringValue("stage"),
    tagId: stringValue("tagId"),
    listId: stringValue("listId"),
    accountId: stringValue("accountId"),
    segmentId: stringValue("segmentId"),
    scoreMin: stringValue("scoreMin"),
    scoreMax: stringValue("scoreMax"),
    sort,
    direction,
  };
}

export function buildContactSearchInput(search: ContactSearch): ContactListInput {
  const query = search.q.trim();
  const scoreMin = optionalNumber(search.scoreMin);
  const scoreMax = optionalNumber(search.scoreMax);

  return {
    limit: 100,
    status: search.status,
    sort: search.sort,
    direction: search.direction,
    ...(query ? { query } : {}),
    ...(search.stage ? { stage: search.stage } : {}),
    ...(search.tagId ? { tagId: search.tagId } : {}),
    ...(search.listId ? { listId: search.listId } : {}),
    ...(search.accountId ? { accountId: search.accountId } : {}),
    ...(search.segmentId ? { segmentId: search.segmentId } : {}),
    ...(scoreMin === undefined ? {} : { scoreMin }),
    ...(scoreMax === undefined ? {} : { scoreMax }),
  };
}

export function contactsQueryOptions(search: ContactSearch) {
  return orpcQuery.contacts.list.queryOptions({
    input: buildContactSearchInput(search),
  });
}

export function contactOptionsQueryOptions() {
  return queryOptions({
    queryKey: contactOptionsQueryKey,
    queryFn: ({ signal }) => loadContactOptions(signal),
  });
}

export async function loadContactOptions(signal?: AbortSignal): Promise<ContactOptions> {
  return orpc.contactResources.options(undefined, signal ? { signal } : undefined);
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

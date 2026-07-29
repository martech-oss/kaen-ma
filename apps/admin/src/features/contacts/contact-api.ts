import type { Contact, SegmentFilter } from "@kaenma/shared";
import { api } from "@/api";

export interface TagOption {
  id: string;
  name: string;
  slug: string;
  color: string;
  contact_count?: number;
}

export interface ListOption {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color: string;
  contact_count?: number;
}

export interface SegmentOption {
  id: string;
  name: string;
  slug: string;
  kind: "static" | "dynamic";
  filter_ast: SegmentFilter | null;
  member_count: number;
  evaluated_at: string | null;
}

export interface AccountOption {
  id: string;
  name: string;
  domain: string | null;
  contact_count?: number;
}

export interface ContactOptions {
  tags: TagOption[];
  lists: ListOption[];
  segments: SegmentOption[];
  accounts: AccountOption[];
  stages: Array<{ stage: string; contact_count: number }>;
}

export interface ContactSummary extends Contact {
  tags: TagOption[];
  lists: ListOption[];
  accounts: Array<
    AccountOption & {
      title: string | null;
      is_primary: boolean;
    }
  >;
}

export interface ContactListResult {
  contacts: ContactSummary[];
  total: number;
}

export interface ContactsPageData extends ContactListResult {
  options: ContactOptions;
}

export type ContactStatus = "active" | "archived" | "anonymous" | "all";

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
  sort: string;
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

const contactStatuses = new Set<ContactStatus>([
  "active",
  "archived",
  "anonymous",
  "all",
]);
const contactSorts = new Set([
  "updatedAt",
  "createdAt",
  "score",
  "name",
  "email",
]);

export function parseContactSearch(
  search: Record<string, unknown>,
): ContactSearch {
  const status =
    typeof search.status === "string" &&
    contactStatuses.has(search.status as ContactStatus)
      ? (search.status as ContactStatus)
      : contactSearchDefaults.status;
  const sort =
    typeof search.sort === "string" && contactSorts.has(search.sort)
      ? search.sort
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

export function buildContactSearchParams(
  search: ContactSearch,
): URLSearchParams {
  const params = new URLSearchParams({
    limit: "100",
    status: search.status,
    sort: search.sort,
    direction: search.direction,
  });
  const optionalParams = [
    ["q", search.q.trim()],
    ["stage", search.stage],
    ["tagId", search.tagId],
    ["listId", search.listId],
    ["accountId", search.accountId],
    ["segmentId", search.segmentId],
    ["scoreMin", search.scoreMin],
    ["scoreMax", search.scoreMax],
  ] as const;
  for (const [key, value] of optionalParams) {
    if (value) params.set(key, value);
  }
  return params;
}

export async function loadContactOptions(
  signal?: AbortSignal,
): Promise<ContactOptions> {
  const response = await api<ContactOptions>("/contact-options", {
    signal: signal ?? null,
  });
  return response.data;
}

export async function loadContacts(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<ContactListResult> {
  const response = await api<ContactSummary[]>(
    `/contacts?${params.toString()}`,
    { signal: signal ?? null },
  );
  return {
    contacts: response.data,
    total: response.meta?.total ?? response.data.length,
  };
}

export async function loadContactsPage(
  search: ContactSearch = contactSearchDefaults,
  signal?: AbortSignal,
): Promise<ContactsPageData> {
  const [contacts, options] = await Promise.all([
    loadContacts(buildContactSearchParams(search), signal),
    loadContactOptions(signal),
  ]);
  return { ...contacts, options };
}

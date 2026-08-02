import { orpc, orpcQuery } from "@/lib/orpc";
import type { CompanyContactDto, CompanyDetail, CompanySummary } from "@kaenma/orpc";

export type {
  CompanyContactDto as AccountContact,
  CompanyDetail as AccountDetail,
  CompanySummary as AccountSummary,
};

/** A contact offered when attaching one to an account. */
export interface ContactOption {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface AccountDetailData {
  account: CompanyDetail;
  contacts: ContactOption[];
}

export interface AccountSearch {
  q: string;
}

export const accountSearchDefaults: AccountSearch = { q: "" };

export function accountsQueryOptions(query = "") {
  return orpcQuery.companies.list.queryOptions({
    input: { limit: 200, ...(query.trim() ? { query: query.trim() } : {}) },
  });
}

export function accountQueryOptions(accountId: string) {
  return orpcQuery.companies.get.queryOptions({ input: { id: accountId } });
}

export async function loadAccounts(query = "", signal?: AbortSignal): Promise<CompanySummary[]> {
  return orpc.companies.list(
    { limit: 200, ...(query.trim() ? { query: query.trim() } : {}) },
    signal ? { signal } : undefined,
  );
}

export async function loadAccountDetail(
  accountId: string,
  signal?: AbortSignal,
): Promise<AccountDetailData> {
  const [account, contacts] = await Promise.all([
    orpc.companies.get({ id: accountId }, signal ? { signal } : undefined),
    orpc.contacts.list(
      { limit: 100, status: "active", sort: "name", direction: "asc" },
      signal ? { signal } : undefined,
    ),
  ]);
  return {
    account,
    contacts: contacts.items.map((contact) => ({
      id: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })),
  };
}

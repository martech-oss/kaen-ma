import { orpc, orpcQuery } from "@/lib/orpc";
import type { AccountContact, AccountDetail, AccountSummary } from "@kaenma/orpc";

export type { AccountContact, AccountDetail, AccountSummary };

/** A contact offered when attaching one to an account. */
export interface ContactOption {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface AccountDetailData {
  account: AccountDetail;
  contacts: ContactOption[];
}

export interface AccountSearch {
  q: string;
}

export const accountSearchDefaults: AccountSearch = { q: "" };

export function accountsQueryOptions(query = "") {
  return orpcQuery.accounts.list.queryOptions({
    input: { limit: 200, ...(query.trim() ? { query: query.trim() } : {}) },
  });
}

export function accountQueryOptions(accountId: string) {
  return orpcQuery.accounts.get.queryOptions({ input: { id: accountId } });
}

export async function loadAccounts(query = "", signal?: AbortSignal): Promise<AccountSummary[]> {
  return orpc.accounts.list(
    { limit: 200, ...(query.trim() ? { query: query.trim() } : {}) },
    signal ? { signal } : undefined,
  );
}

export async function loadAccountDetail(
  accountId: string,
  signal?: AbortSignal,
): Promise<AccountDetailData> {
  const [account, contacts] = await Promise.all([
    orpc.accounts.get({ id: accountId }, signal ? { signal } : undefined),
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

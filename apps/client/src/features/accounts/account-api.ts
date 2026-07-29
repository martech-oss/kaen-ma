import { rpc } from "@/rpc";

export interface AccountSummary {
  id: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountContact {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  stage: string;
  score: number;
  status: "active" | "archived" | "anonymous";
  title: string | null;
  is_primary: boolean;
}

export interface AccountDetail extends Omit<AccountSummary, "contactCount"> {
  contacts: AccountContact[];
}

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

export async function loadAccounts(query = "", signal?: AbortSignal): Promise<AccountSummary[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (query.trim()) params.set("q", query.trim());
  const response = await rpc<AccountSummary[]>(`/accounts?${params.toString()}`, {
    signal: signal ?? null,
  });
  return response.data;
}

export async function loadAccountDetail(
  accountId: string,
  signal?: AbortSignal,
): Promise<AccountDetailData> {
  const [account, contacts] = await Promise.all([
    rpc<AccountDetail>(`/accounts/${accountId}`, {
      signal: signal ?? null,
    }),
    rpc<ContactOption[]>("/contacts?limit=100&status=active&sort=name&direction=asc", {
      signal: signal ?? null,
    }),
  ]);
  return { account: account.data, contacts: contacts.data };
}

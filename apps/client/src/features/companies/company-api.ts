import type { CompanyContactDto, CompanyDetail, CompanySummary } from "@openengage/core/contacts";

import { orpc, orpcQuery } from "@/lib/orpc";

export type { CompanyContactDto, CompanyDetail, CompanySummary };

/** A contact offered when attaching one to a company. */
export interface ContactOption {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface CompanySearch {
  q: string;
}

export const companySearchDefaults: CompanySearch = { q: "" };

export function companiesQueryOptions(query = "") {
  return orpcQuery.companies.list.queryOptions({
    input: { limit: 200, ...(query.trim() ? { query: query.trim() } : {}) },
  });
}

export function companyQueryOptions(companyId: string) {
  return orpcQuery.companies.get.queryOptions({ input: { id: companyId } });
}

/** Active contacts offered when assigning one to a company. */
export function companyContactOptionsQueryOptions() {
  return orpcQuery.contacts.list.queryOptions({
    input: { limit: 100, status: "active", sort: "name", direction: "asc" },
  });
}

export function assignCompanyContact(input: {
  companyId: string;
  contactId: string;
  isPrimary: boolean;
}) {
  return orpc.companies.assignContact({
    id: input.companyId,
    contactId: input.contactId,
    isPrimary: input.isPrimary,
  });
}

export function removeCompanyContact(companyId: string, contactId: string) {
  return orpc.companies.removeContact({ id: companyId, contactId });
}

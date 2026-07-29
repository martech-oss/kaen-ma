import { api } from "@/api";

export interface TagResource {
  id: string;
  name: string;
  slug: string;
  color: string;
  contact_count: number;
}

export interface ListResource {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  contact_count: number;
}

export interface ContactResources {
  tags: TagResource[];
  lists: ListResource[];
}

export async function loadContactResources(
  signal?: AbortSignal,
): Promise<ContactResources> {
  const response = await api<ContactResources>("/contact-options", {
    signal: signal ?? null,
  });
  return response.data;
}

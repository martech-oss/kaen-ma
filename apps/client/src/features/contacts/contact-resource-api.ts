import { orpc } from "@/lib/orpc";
import type { ContactList, ContactOptions, Tag } from "@kaenma/orpc";

export type TagResource = Tag;
export type ListResource = ContactList;

export interface ContactResources {
  tags: TagResource[];
  lists: ListResource[];
}

export async function loadContactResources(signal?: AbortSignal): Promise<ContactResources> {
  const options: ContactOptions = await orpc.contactResources.options(
    undefined,
    signal ? { signal } : undefined,
  );
  return { tags: options.tags, lists: options.lists };
}

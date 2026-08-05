import type { ContactOptions, Tag, TagCreate } from "@openengage/core/contacts";

import { orpc } from "@/lib/orpc";

export type TagResource = Tag;

export interface ContactResources {
  tags: TagResource[];
}

export async function loadContactResources(signal?: AbortSignal): Promise<ContactResources> {
  const options: ContactOptions = await orpc.contacts.options(
    undefined,
    signal ? { signal } : undefined,
  );
  return { tags: options.tags };
}

export function createContactTag(input: TagCreate) {
  return orpc.contacts.createTag(input);
}

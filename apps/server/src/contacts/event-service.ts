import { contactEvents, type KaenmaDatabase, uuidv7 } from "@kaenma/database";

import { enrollAutomationsForEvent } from "../automations/enrollment";

export interface ContactEventInput {
  id?: string;
  workspaceId: string;
  contactId: string | null;
  visitorId?: string | null;
  type: string;
  resourceType?: string | null;
  resourceId?: string | null;
  properties?: Record<string, unknown>;
  occurredAt?: string;
}

export async function recordContactEvent(
  database: KaenmaDatabase,
  input: ContactEventInput,
): Promise<{ eventId: string; enrollmentCount: number }> {
  const eventId = input.id ?? uuidv7();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  await database.orm.insert(contactEvents).values({
    id: eventId,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    visitorId: input.visitorId ?? null,
    type: input.type,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    properties: JSON.stringify(input.properties ?? {}),
    occurredAt,
    createdAt: new Date().toISOString(),
  });
  if (!input.contactId) return { eventId, enrollmentCount: 0 };
  const enrollments = await enrollAutomationsForEvent(database, {
    id: eventId,
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    type: input.type,
    ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
  });
  return { eventId, enrollmentCount: enrollments.length };
}

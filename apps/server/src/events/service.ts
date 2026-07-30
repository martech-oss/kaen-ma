import { type KaenmaDatabase, uuidv7 } from "@kaenma/database";

import { enrollAutomationsForEvent } from "../campaigns/enrollment";

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
  await database
    .prepare(
      `INSERT INTO contact_events
       (id, workspace_id, contact_id, visitor_id, type, resource_type, resource_id,
        properties, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      eventId,
      input.workspaceId,
      input.contactId,
      input.visitorId ?? null,
      input.type,
      input.resourceType ?? null,
      input.resourceId ?? null,
      JSON.stringify(input.properties ?? {}),
      occurredAt,
      new Date().toISOString(),
    )
    .run();
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

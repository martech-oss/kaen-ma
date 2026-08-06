import * as z from "zod";

/** `{ id: <non-empty string> }` — the id-only input shared by single-resource lookups and mutations. */
export const idInput = z.object({ id: z.string().min(1) });

/**
 * The generic mutation acknowledgement. Every procedure whose only job is to
 * confirm an action succeeded (archive, restore, delete, assign, ...) returns
 * this instead of a bespoke per-verb `{ <verb>: true }` shape.
 */
export const ackSchema = z.object({ ok: z.literal(true) });
export type Ack = z.infer<typeof ackSchema>;
export const ack: Ack = { ok: true };

/** Builds a domain-prefixed 404 error entry, e.g. `notFoundError("FORM_NOT_FOUND", "...")`. */
export function notFoundError<const Code extends string>(
  code: Code,
  message: string,
): Record<Code, { status: 404; message: string }> {
  return { [code]: { status: 404, message } } as Record<Code, { status: 404; message: string }>;
}

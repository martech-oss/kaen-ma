/**
 * Readers for `FormData` entries that normalise blank input away.
 *
 * Both trim the value and treat the empty string as "not provided"; they differ
 * only in what they return for it. Pick the one matching the field's type in the
 * request schema — `undefined` means "leave unchanged", `null` means "clear it".
 */

function trimmed(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Reads a field as-is (untrimmed), or "" if it's missing or not a string. */
export function getFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Blank becomes `undefined` — for optional fields that are omitted when empty. */
export function optionalString(value: FormDataEntryValue | null): string | undefined {
  return trimmed(value) || undefined;
}

/** Blank becomes `null` — for nullable fields that are explicitly cleared when empty. */
export function nullableString(value: FormDataEntryValue | null): string | null {
  return trimmed(value) || null;
}

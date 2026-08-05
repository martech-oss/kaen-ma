export interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export class DatabaseDecodeError extends Error {
  public override readonly name = "DatabaseDecodeError";

  public constructor(
    public readonly field: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid JSON stored in ${field}`, options);
  }
}

/** Parse and validate a JSON column at the repository boundary. */
export function decodeJson<T>(value: string, schema: RuntimeSchema<T>, field: string): T {
  try {
    return schema.parse(JSON.parse(value));
  } catch (cause) {
    throw new DatabaseDecodeError(field, { cause });
  }
}

export function decodeNullableJson<T>(
  value: string | null,
  schema: RuntimeSchema<T>,
  field: string,
): T | null {
  return value === null ? null : decodeJson(value, schema, field);
}

/** Validate before serializing values written to a JSON column. */
export function encodeJson<T>(value: unknown, schema: RuntimeSchema<T>, field: string): string {
  try {
    return JSON.stringify(schema.parse(value));
  } catch (cause) {
    throw new DatabaseDecodeError(field, { cause });
  }
}

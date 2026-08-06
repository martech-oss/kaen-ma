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

/** Binds a schema to one `table.column` field, so call sites stop repeating the pair. */
export function defineJsonCodec<T>(schema: RuntimeSchema<T>, field: string) {
  return {
    decode: (value: string): T => decodeJson(value, schema, field),
    decodeNullable: (value: string | null): T | null => decodeNullableJson(value, schema, field),
    encode: (value: unknown): string => encodeJson(value, schema, field),
  };
}

import { describe, expect, it } from "vitest";

import { jsonRecordSchema, stringArraySchema } from "@openengage/core/shared";

import { DatabaseDecodeError, decodeJson, decodeNullableJson, encodeJson } from "./json-codec";

describe("database JSON codec", () => {
  it("round-trips validated values", () => {
    const value = { enabled: true, count: 3 };
    expect(
      decodeJson(encodeJson(value, jsonRecordSchema, "test.value"), jsonRecordSchema, "test.value"),
    ).toEqual(value);
  });

  it("preserves nullable columns", () => {
    expect(decodeNullableJson(null, stringArraySchema, "test.values")).toBeNull();
  });

  it.each(["not-json", "[]"])("rejects invalid record JSON: %s", (value) => {
    expect(() => decodeJson(value, jsonRecordSchema, "test.value")).toThrow(DatabaseDecodeError);
  });
});

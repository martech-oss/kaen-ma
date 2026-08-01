import { describe, expect, it } from "vitest";

import {
  isRecord,
  nullablePrimitiveString,
  numericValue,
  parseJsonRecord,
  parseJsonValue,
  primitiveString,
  stringOrNull,
} from "../src/values";

describe("value normalization", () => {
  it("recognizes plain records", () => {
    expect(isRecord({ key: "value" })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it("normalizes primitive strings", () => {
    expect(primitiveString(42)).toBe("42");
    expect(primitiveString(false)).toBe("false");
    expect(primitiveString({})).toBe("");
    expect(nullablePrimitiveString(null)).toBeNull();
    expect(nullablePrimitiveString(42)).toBe("42");
  });

  it("normalizes trimmed optional strings", () => {
    expect(stringOrNull("  value  ")).toBe("value");
    expect(stringOrNull("   ")).toBeNull();
    expect(stringOrNull(42)).toBeNull();
  });

  it("coerces aggregate values to numbers", () => {
    expect(numericValue("12")).toBe(12);
    expect(numericValue(null)).toBe(0);
  });

  it("parses JSON with a fallback", () => {
    expect(parseJsonValue('["one"]', [])).toEqual(["one"]);
    expect(parseJsonValue("invalid", ["fallback"])).toEqual(["fallback"]);
    expect(parseJsonValue({ key: "value" }, null)).toBeNull();
  });

  it("accepts only object-shaped JSON records", () => {
    expect(parseJsonRecord('{"key":"value"}')).toEqual({ key: "value" });
    expect(parseJsonRecord({ key: "value" })).toEqual({ key: "value" });
    expect(parseJsonRecord("[]")).toEqual({});
    expect(parseJsonRecord("invalid")).toEqual({});
  });
});

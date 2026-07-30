import * as z from "zod";

import { apiError } from "../middleware";
import { isRecord } from "../values";

export function resourceSlug(value: string, fallbackId: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || `item-${fallbackId.slice(0, 8)}`;
}

export async function safeJson(context: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return null;
  }
}

export function validationError(
  context: Parameters<typeof apiError>[0],
  error: z.ZodError,
): Response {
  return apiError(context, 422, "validation_error", "入力内容を確認してください", error.issues);
}

export function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function parseJsonColumns(keys: string[]) {
  return (row: unknown): Record<string, unknown> => {
    if (!isRecord(row)) return {};
    const result = { ...row };
    for (const key of keys) {
      if (typeof result[key] === "string") {
        try {
          result[key] = JSON.parse(result[key]);
        } catch {
          result[key] = null;
        }
      }
    }
    return result;
  };
}

export function sanitizeFilename(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 191);
}

export async function sha256HexFromBytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomString(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

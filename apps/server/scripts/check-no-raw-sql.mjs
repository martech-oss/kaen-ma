#!/usr/bin/env node
// Guards the P5-P7 repository extraction: every raw SQL string that used to
// live in apps/server now lives in packages/database repositories, built on
// the Drizzle query builder or `sql` tagged templates with ${table.col}
// interpolation. This keeps identifier renames (P8) compiler-driven instead
// of grep-and-pray.
//
// This runs as a plain Node script (wired into `pnpm test`) rather than a
// vitest test: apps/server's vitest.config.ts runs every test through
// @cloudflare/vitest-pool-workers, whose workerd sandbox has no real
// filesystem access, so `node:fs` reads fail there.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../../src");

function listTsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

const offenders = listTsFiles(root)
  .map((path) => ({ path, text: readFileSync(path, "utf8") }))
  .filter(({ text }) => text.includes(".prepare("))
  .map(({ path }) => path.slice(root.length + 1));

if (offenders.length > 0) {
  console.error(
    "Raw .prepare( calls found in apps/server/src (SQL must live in @kaenma/database):",
  );
  for (const path of offenders) console.error(`  - ${path}`);
  process.exit(1);
}
console.log("no-raw-sql: apps/server/src is clean.");

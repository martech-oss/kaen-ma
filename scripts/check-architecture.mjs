import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoots = [resolve(root, "apps"), resolve(root, "packages")];
const files = [];
for (const sourceRoot of sourceRoots) await collectSourceFiles(sourceRoot, files);

const sourceSet = new Set(files);
const graph = new Map(files.map((file) => [file, []]));
const violations = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const imports = [
    ...source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g),
  ].map((match) => match[1]);
  const workspacePath = relative(root, file);

  if (
    (workspacePath.startsWith("packages/core/src/") ||
      workspacePath.startsWith("packages/database/src/") ||
      workspacePath.startsWith("packages/channels/src/") ||
      workspacePath.startsWith("packages/content-renderer/src/")) &&
    imports.includes("@openengage/orpc")
  ) {
    violations.push(`${workspacePath}: lower-level package must not import @openengage/orpc`);
  }
  if (
    workspacePath.startsWith("apps/client/src/") &&
    extname(file) === ".tsx" &&
    /\borpc\.[a-z]/.test(source)
  ) {
    violations.push(`${workspacePath}: components must call feature APIs or query/mutation hooks`);
  }

  for (const specifier of imports.filter((value) => value.startsWith("."))) {
    const target = resolveImport(file, specifier);
    if (target) graph.get(file).push(target);
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
for (const file of files) visit(file);

if (violations.length > 0) {
  process.stderr.write(
    `Architecture violations:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `architecture: ${files.length} source files checked; no forbidden dependencies or cycles.\n`,
  );
}

async function collectSourceFiles(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["dist", "node_modules", ".wrangler"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(path, output);
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".gen.ts")
    )
      output.push(path);
  }
}

function resolveImport(importer, specifier) {
  const base = resolve(dirname(importer), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/, ".ts"),
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    if (sourceSet.has(candidate)) return candidate;
  }
  return undefined;
}

function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map((item) => relative(root, item)).join(" -> ");
    violations.push(`dependency cycle: ${cycle}`);
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file)) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

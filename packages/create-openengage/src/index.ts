#!/usr/bin/env node
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";

import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  password,
  spinner,
  text,
} from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";

import { initialWorkerDeployCommands, rewriteWorkerConfigs } from "./provisioning";

const command = process.argv[2] ?? "create";

intro(pc.bgMagenta(pc.white(" OpenEngage ")));

try {
  if (command === "doctor") await doctor();
  else if (command === "update") await update();
  else if (command === "backup") await backup();
  else if (command === "domain" && process.argv[3] === "add") await addDomain();
  else await create();
} catch (error) {
  cancel(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function create(): Promise<void> {
  const directoryAnswer = await text({
    message: "Project directory",
    placeholder: "openengage",
    defaultValue: process.argv[2] && process.argv[2] !== "create" ? process.argv[2] : "openengage",
    validate: (value) => (!value.trim() ? "Directory is required" : undefined),
  });
  if (isCancel(directoryAnswer)) return abort();
  const appUrlAnswer = await text({
    message: "Production URL",
    placeholder: "https://ma.example.com",
    validate: (value) => {
      try {
        return new URL(value).protocol === "https:" ? undefined : "HTTPS is required";
      } catch {
        return "Enter a valid URL";
      }
    },
  });
  if (isCancel(appUrlAnswer)) return abort();
  const provisionAnswer = await confirm({
    message: "Provision D1, R2, Queues, secrets, migrations, and deploy now?",
    initialValue: true,
  });
  if (isCancel(provisionAnswer)) return abort();
  const projectDirectory = resolve(String(directoryAnswer));
  const progress = spinner();
  progress.start("Preparing source");
  if (!(await exists(resolve(projectDirectory, "apps/server/wrangler.jsonc")))) {
    const source = process.env["OPENENGAGE_TEMPLATE_DIR"];
    if (source) {
      await mkdir(projectDirectory, { recursive: true });
      await cp(resolve(source), projectDirectory, { recursive: true });
    } else {
      const repository =
        process.env["OPENENGAGE_TEMPLATE_REPOSITORY"] ??
        "https://github.com/martech-oss/openengage.git";
      await execa("git", ["clone", "--depth=1", repository, projectDirectory]);
    }
  }
  await execa("pnpm", ["install"], { cwd: projectDirectory });
  progress.stop("Source is ready");
  if (!provisionAnswer) {
    outro(`Run ${pc.cyan("npx create-openengage doctor")} from the project when ready.`);
    return;
  }
  await provision(projectDirectory, String(appUrlAnswer));
  outro(`OpenEngage deployed from ${pc.cyan(projectDirectory)}`);
}

async function provision(projectDirectory: string, appUrl: string): Promise<void> {
  const projectName = slugify(basename(projectDirectory));
  await execa("pnpm", ["wrangler", "whoami"], { cwd: projectDirectory });
  const d1 = await execa("pnpm", ["wrangler", "d1", "create", `${projectName}-db`, "--json"], {
    cwd: projectDirectory,
  });
  const d1Payload = JSON.parse(d1.stdout) as { uuid?: string } | Array<{ uuid?: string }>;
  const databaseId = Array.isArray(d1Payload) ? d1Payload[0]?.uuid : d1Payload.uuid;
  if (!databaseId) throw new Error("Wrangler did not return a D1 database ID");
  await runAllowExisting(
    "pnpm",
    ["wrangler", "r2", "bucket", "create", `${projectName}-assets`],
    projectDirectory,
  );
  for (const queueName of ["campaign", "delivery", "dead-letter"]) {
    await runAllowExisting(
      "pnpm",
      ["wrangler", "queues", "create", `${projectName}-${queueName}`],
      projectDirectory,
    );
  }
  const serverConfigPath = resolve(projectDirectory, "apps/server/wrangler.jsonc");
  const clientConfigPath = resolve(projectDirectory, "apps/client/wrangler.jsonc");
  const agentConfigPath = resolve(projectDirectory, "apps/agent/wrangler.jsonc");
  const workerConfigs = rewriteWorkerConfigs({
    projectName,
    appUrl,
    databaseId,
    server: await readFile(serverConfigPath, "utf8"),
    agent: await readFile(agentConfigPath, "utf8"),
    client: await readFile(clientConfigPath, "utf8"),
  });
  await Promise.all([
    writeFile(serverConfigPath, workerConfigs.server),
    writeFile(agentConfigPath, workerConfigs.agent),
    writeFile(clientConfigPath, workerConfigs.client),
  ]);

  const betterAuthSecret = randomSecret();
  const encryptionKey = randomSecret();
  const trackingSecret = randomSecret();
  await putSecret(projectDirectory, "BETTER_AUTH_SECRET", betterAuthSecret);
  await putSecret(projectDirectory, "CREDENTIAL_ENCRYPTION_KEY", encryptionKey);
  await putSecret(projectDirectory, "TRACKING_SIGNING_SECRET", trackingSecret);
  const turnstile = await password({ message: "Turnstile secret (optional)", mask: "•" });
  if (!isCancel(turnstile) && turnstile) {
    await putSecret(projectDirectory, "TURNSTILE_SECRET", String(turnstile));
  }
  const resendSendApiKey = await password({
    message: "Resend send API key (optional)",
    mask: "•",
  });
  if (!isCancel(resendSendApiKey) && resendSendApiKey) {
    await putSecret(projectDirectory, "RESEND_SEND_API_KEY", String(resendSendApiKey));
  }
  const resendManagementApiKey = await password({
    message: "Resend template management API key (optional)",
    mask: "•",
  });
  if (!isCancel(resendManagementApiKey) && resendManagementApiKey) {
    await putSecret(projectDirectory, "RESEND_MANAGEMENT_API_KEY", String(resendManagementApiKey));
  }
  const resendWebhookSecret = await password({
    message: "Resend webhook signing secret (optional)",
    mask: "•",
  });
  if (!isCancel(resendWebhookSecret) && resendWebhookSecret) {
    await putSecret(projectDirectory, "RESEND_WEBHOOK_SECRET", String(resendWebhookSecret));
  }
  const progress = spinner();
  progress.start("Syncing templates, applying migrations, and deploying");
  if (!isCancel(resendManagementApiKey) && resendManagementApiKey) {
    await execa("pnpm", ["--filter", "@openengage/email-templates", "resend:sync"], {
      cwd: projectDirectory,
      env: { RESEND_MANAGEMENT_API_KEY: String(resendManagementApiKey) },
    });
  }
  await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      `${projectName}-db`,
      "--remote",
    ],
    { cwd: projectDirectory, input: "y\n" },
  );
  // Create the private Agent Worker without its reverse binding first. This
  // breaks the Agent <-> Server service-binding cycle on a fresh account.
  for (const args of initialWorkerDeployCommands) {
    await execa("pnpm", [...args], { cwd: projectDirectory });
  }
  progress.stop("Infrastructure and Workers are ready");
}

async function doctor(): Promise<void> {
  const projectDirectory = process.cwd();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push(
    await commandCheck("Cloudflare login", "pnpm", ["wrangler", "whoami"], projectDirectory),
  );
  checks.push(await commandCheck("Worker bindings", "pnpm", ["cf:types"], projectDirectory));
  checks.push(
    await commandCheck(
      "D1 schema",
      "pnpm",
      [
        "--filter",
        "@openengage/server",
        "exec",
        "wrangler",
        "d1",
        "execute",
        "openengage-db",
        "--remote",
        "--command",
        "SELECT COUNT(*) FROM d1_migrations",
      ],
      projectDirectory,
    ),
  );
  checks.push(
    await commandCheck("Queues", "pnpm", ["wrangler", "queues", "list"], projectDirectory),
  );
  checks.push(
    await commandCheck("R2", "pnpm", ["wrangler", "r2", "bucket", "list"], projectDirectory),
  );
  checks.push(
    await commandCheck(
      "Secrets",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "secret", "list"],
      projectDirectory,
    ),
  );
  const config = await readFile(resolve(projectDirectory, "apps/server/wrangler.jsonc"), "utf8");
  checks.push({
    name: "D1 database ID",
    ok: !config.includes("00000000-0000-0000-0000-000000000000"),
    detail: config.includes("00000000-0000-0000-0000-000000000000")
      ? "Replace the placeholder by running create-openengage provisioning"
      : "configured",
  });
  note(
    checks
      .map((check) => `${check.ok ? pc.green("✓") : pc.red("✗")} ${check.name}: ${check.detail}`)
      .join("\n"),
    "Doctor report",
  );
  if (checks.some((check) => !check.ok)) throw new Error("Doctor found configuration problems");
  outro("All mandatory checks passed");
}

async function update(): Promise<void> {
  const approved = await confirm({
    message: "Pull changes, install dependencies, apply remote migrations, and deploy?",
    initialValue: false,
  });
  if (isCancel(approved) || !approved) return abort();
  await execa("git", ["pull", "--ff-only"], { cwd: process.cwd(), stdio: "inherit" });
  await execa("pnpm", ["install"], { cwd: process.cwd(), stdio: "inherit" });
  await execa("pnpm", ["db:migrate:remote"], {
    cwd: process.cwd(),
    input: "y\n",
    stdio: ["pipe", "inherit", "inherit"],
  });
  await execa("pnpm", ["deploy"], { cwd: process.cwd(), stdio: "inherit" });
  outro("OpenEngage updated");
}

async function backup(): Promise<void> {
  const outputAnswer = await text({
    message: "Backup file",
    defaultValue: `backups/openengage-${new Date().toISOString().slice(0, 10)}.sql`,
  });
  if (isCancel(outputAnswer)) return abort();
  const output = resolve(String(outputAnswer));
  await mkdir(resolve(output, ".."), { recursive: true });
  await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "d1",
      "export",
      "openengage-db",
      "--remote",
      "--output",
      output,
    ],
    { cwd: process.cwd(), stdio: "inherit" },
  );
  outro(`D1 backup written to ${pc.cyan(output)}. R2 objects remain versioned in the bucket.`);
}

async function addDomain(): Promise<void> {
  const domainAnswer = await text({
    message: "Custom domain",
    placeholder: "ma.example.com",
    validate: (value) =>
      /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) ? undefined : "Enter a hostname",
  });
  if (isCancel(domainAnswer)) return abort();
  const configPath = resolve(process.cwd(), "apps/client/wrangler.jsonc");
  let config = await readFile(configPath, "utf8");
  if (!config.includes('"routes"')) {
    config = config.replace(
      '"workers_dev": true,',
      `"workers_dev": true,\n  "routes": [{ "pattern": "${String(domainAnswer)}", "custom_domain": true }],`,
    );
    await writeFile(configPath, config);
  }
  await execa("pnpm", ["deploy"], { cwd: process.cwd(), stdio: "inherit" });
  outro(`Custom domain ${pc.cyan(String(domainAnswer))} deployed`);
}

async function putSecret(directory: string, name: string, value: string): Promise<void> {
  await execa(
    "pnpm",
    ["--filter", "@openengage/server", "exec", "wrangler", "secret", "put", name],
    {
      cwd: directory,
      input: value,
    },
  );
}

async function runAllowExisting(file: string, args: string[], cwd: string): Promise<void> {
  try {
    await execa(file, args, { cwd });
  } catch (error) {
    const detail = error instanceof Error ? error.message.toLowerCase() : String(error);
    if (!detail.includes("already exists")) throw error;
  }
}

async function commandCheck(
  name: string,
  file: string,
  args: string[],
  cwd: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    await execa(file, args, { cwd });
    return { name, ok: true, detail: "ok" };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "openengage"
  );
}

function abort(): never {
  cancel("Cancelled");
  process.exit(0);
}

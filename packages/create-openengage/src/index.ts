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

import { createCommandRunner } from "./command-runner";
import {
  cloudflareResourceNames,
  initialWorkerDeployCommands,
  readConfiguredResources,
  rewriteWorkerConfigs,
} from "./provisioning";

const commandRunner = createCommandRunner(async (file, args, { cwd }) => {
  const result = await execa(file, args, { cwd });
  return { stdout: result.stdout };
});

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? "create";
  intro(pc.bgMagenta(pc.white(" OpenEngage ")));

  try {
    if (command === "doctor") await doctor();
    else if (command === "update") await update();
    else if (command === "backup") await backup();
    else if (command === "domain" && args[1] === "add") await addDomain();
    else await create(command === "create" ? undefined : command);
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function create(directoryArgument?: string): Promise<void> {
  const directoryAnswer = await text({
    message: "Project directory",
    placeholder: "openengage",
    defaultValue: directoryArgument ?? "openengage",
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
  const defaultSendingDomain = new URL(String(appUrlAnswer)).hostname;
  const sendingDomainAnswer = await text({
    message: "Cloudflare Email Sending domain",
    placeholder: defaultSendingDomain,
    defaultValue: defaultSendingDomain,
    validate: (value) =>
      /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) ? undefined : "Enter a valid domain",
  });
  if (isCancel(sendingDomainAnswer)) return abort();
  const transactionalFromEmail = await text({
    message: "Transactional from address",
    placeholder: `notifications@${String(sendingDomainAnswer)}`,
    defaultValue: `notifications@${String(sendingDomainAnswer)}`,
    validate: (value) =>
      value.toLowerCase().endsWith(`@${String(sendingDomainAnswer).toLowerCase()}`)
        ? undefined
        : "The address must use the Email Sending domain",
  });
  if (isCancel(transactionalFromEmail)) return abort();
  const transactionalFromName = await text({
    message: "Transactional from name",
    defaultValue: "OpenEngage",
    validate: (value) => (value.trim() ? undefined : "Sender name is required"),
  });
  if (isCancel(transactionalFromName)) return abort();
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
  await provision(projectDirectory, String(appUrlAnswer), {
    sendingDomain: String(sendingDomainAnswer),
    fromEmail: String(transactionalFromEmail),
    fromName: String(transactionalFromName),
  });
  outro(`OpenEngage deployed from ${pc.cyan(projectDirectory)}`);
}

async function provision(
  projectDirectory: string,
  appUrl: string,
  email: { sendingDomain: string; fromEmail: string; fromName: string },
): Promise<void> {
  const projectName = slugify(basename(projectDirectory));
  const resources = cloudflareResourceNames(projectName);
  await execa("pnpm", ["--filter", "@openengage/server", "exec", "wrangler", "whoami"], {
    cwd: projectDirectory,
  });
  await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "email",
      "sending",
      "enable",
      email.sendingDomain,
    ],
    { cwd: projectDirectory },
  );
  const d1 = await execa(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "d1",
      "create",
      resources.database,
      "--json",
    ],
    { cwd: projectDirectory },
  );
  const d1Payload = JSON.parse(d1.stdout) as { uuid?: string } | Array<{ uuid?: string }>;
  const databaseId = Array.isArray(d1Payload) ? d1Payload[0]?.uuid : d1Payload.uuid;
  if (!databaseId) throw new Error("Wrangler did not return a D1 database ID");
  await runAllowExisting(
    "pnpm",
    [
      "--filter",
      "@openengage/server",
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "create",
      resources.bucket,
    ],
    projectDirectory,
  );
  for (const queueName of Object.values(resources.queues)) {
    await runAllowExisting(
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "queues", "create", queueName],
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
    transactionalFromEmail: email.fromEmail,
    transactionalFromName: email.fromName,
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
  const progress = spinner();
  progress.start("Applying migrations and deploying");
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
      resources.database,
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
  note(
    `Cloudflare DashboardでQueue ${resources.queues.emailEvents}へEmail Sending (${email.sendingDomain}) の delivered, deferred, bounced, failed, rejected, complained を購読してください。完了後に create-openengage doctor を実行してください。`,
    "Email event subscription required",
  );
}

async function doctor(): Promise<void> {
  const projectDirectory = process.cwd();
  const config = await readFile(resolve(projectDirectory, "apps/server/wrangler.jsonc"), "utf8");
  const resources = readConfiguredResources(config);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push(
    await commandCheck(
      "Cloudflare login",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "whoami"],
      projectDirectory,
    ),
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
        resources.database,
        "--remote",
        "--command",
        "SELECT COUNT(*) FROM d1_migrations",
      ],
      projectDirectory,
    ),
  );
  checks.push(
    await commandOutputIncludesCheck(
      "Queues",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "queues", "list", "--json"],
      projectDirectory,
      resources.emailEventsQueue,
    ),
  );
  checks.push(
    await commandCheck(
      "R2",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "r2", "bucket", "list"],
      projectDirectory,
    ),
  );
  checks.push(
    await commandCheck(
      "Secrets",
      "pnpm",
      ["--filter", "@openengage/server", "exec", "wrangler", "secret", "list"],
      projectDirectory,
    ),
  );
  checks.push(
    await commandOutputIncludesCheck(
      "Email Sending domain",
      "pnpm",
      [
        "--filter",
        "@openengage/server",
        "exec",
        "wrangler",
        "email",
        "sending",
        "list",
        resources.sendingDomain,
      ],
      projectDirectory,
      resources.sendingDomain,
    ),
  );
  checks.push({
    name: "EMAIL binding",
    ok: resources.hasEmailBinding,
    detail: resources.hasEmailBinding
      ? `restricted to ${resources.fromEmail}`
      : "configure EMAIL with allowed_sender_addresses",
  });
  checks.push(
    await emailEventSubscriptionCheck(
      projectDirectory,
      resources.emailEventsQueue,
      resources.sendingDomain,
    ),
  );
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
  const serverConfig = await readFile(resolve(process.cwd(), "apps/server/wrangler.jsonc"), "utf8");
  const databaseName = readConfiguredResources(serverConfig).database;
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
      databaseName,
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
  await commandRunner.allowExisting(file, args, cwd);
}

async function commandCheck(
  name: string,
  file: string,
  args: string[],
  cwd: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  return commandRunner.check(name, file, args, cwd);
}

async function commandOutputIncludesCheck(
  name: string,
  file: string,
  args: string[],
  cwd: string,
  expected: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  return commandRunner.outputIncludes(name, file, args, cwd, expected);
}

async function emailEventSubscriptionCheck(
  cwd: string,
  queueName: string,
  sendingDomain: string,
): Promise<{ name: string; ok: boolean; detail: string }> {
  const required = ["delivered", "deferred", "bounced", "failed", "rejected", "complained"];
  try {
    const result = await execa(
      "pnpm",
      [
        "--filter",
        "@openengage/server",
        "exec",
        "wrangler",
        "queues",
        "subscription",
        "list",
        queueName,
        "--json",
      ],
      { cwd },
    );
    const output = result.stdout.toLowerCase();
    const ok =
      output.includes("email.sending") &&
      output.includes(sendingDomain.toLowerCase()) &&
      required.every((event) => output.includes(event));
    return {
      name: "Email event subscription",
      ok,
      detail: ok ? "configured" : "subscribe the six Email Sending events in Cloudflare Dashboard",
    };
  } catch (error) {
    return {
      name: "Email event subscription",
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

import { WorkspaceRepository, reserveIdempotencyKey, uuidv7 } from "@kaenma/db";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { isEmailVerificationRequired, resolveAuthBaseURL } from "../src/auth";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("Kaenma Worker", () => {
  it("uses the actual localhost port for Better Auth during development", () => {
    expect(
      resolveAuthBaseURL(
        { APP_URL: "http://localhost:8787", ENVIRONMENT: "development" },
        "http://localhost:8788",
      ),
    ).toBe("http://localhost:8788");
    expect(
      resolveAuthBaseURL(
        { APP_URL: "https://app.example.com", ENVIRONMENT: "production" },
        "https://evil.example.com",
      ),
    ).toBe("https://app.example.com");
  });

  it("skips email verification only in development", () => {
    expect(isEmailVerificationRequired("development")).toBe(false);
    expect(isEmailVerificationRequired("test")).toBe(true);
    expect(isEmailVerificationRequired("production")).toBe(true);
  });

  it("reports a healthy migrated D1 database", async () => {
    const response = await exports.default.fetch("http://localhost:8787/api/health");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { status: string; migrations: number } };
    expect(payload.data.status).toBe("ok");
    expect(payload.data.migrations).toBeGreaterThan(0);
  });

  it("never returns a contact from another workspace by direct ID", async () => {
    const firstWorkspace = uuidv7();
    const secondWorkspace = uuidv7();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'First', 'first', ?, 'UTC')`,
      ).bind(firstWorkspace, now),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Second', 'second', ?, 'UTC')`,
      ).bind(secondWorkspace, now),
    ]);
    const first = new WorkspaceRepository(env.DB, {
      workspaceId: firstWorkspace,
      userId: "user-one",
      role: "owner",
    });
    const second = new WorkspaceRepository(env.DB, {
      workspaceId: secondWorkspace,
      userId: "user-two",
      role: "owner",
    });
    const contact = await first.createContact({
      email: "person@example.com",
      customFields: {},
    });
    expect(await first.getContact(contact.id)).not.toBeNull();
    expect(await second.getContact(contact.id)).toBeNull();
  });

  it("reserves a delivery idempotency key only once", async () => {
    const workspaceId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Workspace', 'workspace', ?, 'UTC')`,
    )
      .bind(workspaceId, Date.now())
      .run();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(
      await reserveIdempotencyKey(env.DB, workspaceId, "delivery", "same-key", expiresAt),
    ).toBe(true);
    expect(
      await reserveIdempotencyKey(env.DB, workspaceId, "delivery", "same-key", expiresAt),
    ).toBe(false);
  });

  it("accepts Resend provider configuration with valid foreign keys", async () => {
    const workspaceId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO organization (id, name, slug, created_at, timezone)
       VALUES (?, 'Resend Workspace', 'resend-workspace', ?, 'UTC')`,
    )
      .bind(workspaceId, Date.now())
      .run();
    await expect(
      env.DB.prepare(
        `INSERT INTO provider_configs
         (id, workspace_id, provider, name, encrypted_credentials, settings, created_at, updated_at)
         VALUES (?, ?, 'resend', 'default', 'encrypted', '{}', ?, ?)`,
      )
        .bind(uuidv7(), workspaceId, new Date().toISOString(), new Date().toISOString())
        .run(),
    ).resolves.toBeDefined();
    const foreignKeyViolations = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeyViolations.results).toEqual([]);
  });
});

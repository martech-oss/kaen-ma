import { resolve } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        serviceBindings: {
          AGENT_APP: async (request: Request) =>
            new Response(request.body, {
              status: request.method === "POST" ? 202 : 200,
              headers: {
                "content-type": request.headers.get("accept") ?? "application/octet-stream",
                "x-agent-authorization": request.headers.get("authorization") ?? "",
                "x-agent-cookie": request.headers.get("cookie") ?? "",
                "x-agent-path": new URL(request.url).pathname,
                "x-agent-workspace": request.headers.get("x-openengage-workspace") ?? "",
                "x-flue-stream": "preserved",
              },
            }),
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            resolve(__dirname, "../../packages/database/migrations"),
          ),
          BETTER_AUTH_SECRET: "test-better-auth-secret-at-least-32-characters",
          CREDENTIAL_ENCRYPTION_KEY: "test-encryption-key-at-least-32-characters",
          TRACKING_SIGNING_SECRET: "test-tracking-secret-at-least-32-characters",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});

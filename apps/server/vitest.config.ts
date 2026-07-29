import { resolve } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
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

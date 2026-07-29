import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/auth-schema.ts", "./src/business-schema.ts"],
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  strict: true,
  verbose: true,
});

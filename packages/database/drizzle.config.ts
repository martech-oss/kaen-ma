import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/schema.ts"],
  out: process.env.DRIZZLE_OUT ?? "./migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
});

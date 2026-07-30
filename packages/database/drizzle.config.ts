import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/schema.ts"],
  out: process.env.DRIZZLE_OUT ?? "./drizzle",
  strict: true,
  verbose: true,
});

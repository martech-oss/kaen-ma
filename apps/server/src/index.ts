import { app } from "./app";
import { email } from "./email/worker";
import type { RuntimeEnv } from "./env";
import { queue, scheduled } from "./runtime";

export default {
  fetch: app.fetch,
  scheduled,
  queue,
  email,
} satisfies ExportedHandler<RuntimeEnv>;

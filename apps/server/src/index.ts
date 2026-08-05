import { app } from "./app";
import type { RuntimeEnv } from "./env";
import { email } from "./messaging/inbound-worker";
import { queue, scheduled } from "./runtime/dispatch";

export { AgentBackend } from "./agents/backend";

export default {
  fetch: app.fetch,
  scheduled,
  queue,
  email,
} satisfies ExportedHandler<RuntimeEnv>;

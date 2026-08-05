import { PermanentChannelError } from "@openengage/channels";

import type { RuntimeEnv } from "../env";

export async function processBroadcastBatch(
  broadcastId: string,
  phase: "snapshot" | "delivery",
  cursor: string | undefined,
  env: RuntimeEnv,
): Promise<never> {
  void broadcastId;
  void phase;
  void cursor;
  void env;
  throw new PermanentChannelError("Marketing email is disabled");
}

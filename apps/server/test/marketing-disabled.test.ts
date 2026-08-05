import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../src/env";
import { queue } from "../src/runtime/dispatch";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("marketing runtime guard", () => {
  it("dead-letters a directly injected broadcast batch without retrying it", async () => {
    const ack = vi.fn<() => void>();
    const retry = vi.fn<(options?: { delaySeconds?: number }) => void>();
    const message = {
      id: "direct-marketing-message",
      timestamp: new Date("2026-08-05T00:00:00.000Z"),
      attempts: 1,
      body: {
        kind: "broadcast_batch",
        broadcastId: "disabled-broadcast",
        phase: "snapshot",
      },
      ack,
      retry,
    };

    await queue(
      {
        queue: "openengage-campaign",
        messages: [message],
        ackAll: vi.fn<() => void>(),
        retryAll: vi.fn<() => void>(),
      } as unknown as MessageBatch<unknown>,
      env as RuntimeEnv,
    );

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    const deadLetter = await env.DB.prepare(
      "SELECT error, message_body AS messageBody FROM dead_letters WHERE source_queue = ?",
    )
      .bind("openengage-campaign")
      .first<{ error: string; messageBody: string }>();
    expect(deadLetter?.error).toBe("Marketing email is disabled");
    expect(deadLetter?.messageBody).toContain('"kind":"broadcast_batch"');
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { logError } from "../src/observability";

describe("structured error logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits a single parseable JSON object with context", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logError("queue.message_failed", new TypeError("boom"), {
      queue: "campaign",
      attempts: 2,
    });

    expect(output).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      level: "error",
      event: "queue.message_failed",
      context: { queue: "campaign", attempts: 2 },
      error: { name: "TypeError", message: "boom" },
    });
    expect(payload["timestamp"]).toEqual(expect.any(String));
  });
});

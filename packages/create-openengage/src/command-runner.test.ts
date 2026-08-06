import { describe, expect, it, vi } from "vitest";

import { createCommandRunner, type ExecuteCommand } from "./command-runner";

describe("command runner", () => {
  it("parses successful and failed doctor checks without Cloudflare", async () => {
    const execute = vi
      .fn<ExecuteCommand>()
      .mockResolvedValueOnce({ stdout: "openengage-jobs" })
      .mockRejectedValueOnce(new Error("not authenticated\nstack"));
    const runner = createCommandRunner(execute);

    await expect(
      runner.outputIncludes("Queues", "pnpm", ["queues", "list"], "/project", "openengage-jobs"),
    ).resolves.toEqual({ name: "Queues", ok: true, detail: "openengage-jobs" });
    await expect(runner.check("Login", "pnpm", ["whoami"], "/project")).resolves.toEqual({
      name: "Login",
      ok: false,
      detail: "not authenticated",
    });
  });

  it("ignores only the expected already-exists provisioning error", async () => {
    const execute = vi.fn<ExecuteCommand>().mockRejectedValue(new Error("Queue already exists"));
    const runner = createCommandRunner(execute);

    await expect(runner.allowExisting("pnpm", ["queues", "create"], "/project")).resolves.toBe(
      undefined,
    );
  });
});

export interface CommandResult {
  stdout: string;
}

export type ExecuteCommand = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<CommandResult>;

export interface CommandCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function createCommandRunner(execute: ExecuteCommand) {
  return {
    async check(name: string, file: string, args: string[], cwd: string): Promise<CommandCheck> {
      try {
        await execute(file, args, { cwd });
        return { name, ok: true, detail: "ok" };
      } catch (error) {
        return { name, ok: false, detail: firstErrorLine(error) };
      }
    },
    async outputIncludes(
      name: string,
      file: string,
      args: string[],
      cwd: string,
      expected: string,
    ): Promise<CommandCheck> {
      if (!expected) return { name, ok: false, detail: "resource is not configured" };
      try {
        const result = await execute(file, args, { cwd });
        const ok = result.stdout.includes(expected);
        return { name, ok, detail: ok ? expected : `${expected} was not found` };
      } catch (error) {
        return { name, ok: false, detail: firstErrorLine(error) };
      }
    },
    async allowExisting(file: string, args: string[], cwd: string): Promise<void> {
      try {
        await execute(file, args, { cwd });
      } catch (error) {
        const detail = error instanceof Error ? error.message.toLowerCase() : String(error);
        if (!detail.includes("already exists")) throw error;
      }
    },
  };
}

function firstErrorLine(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error);
}

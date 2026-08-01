import { describe, expect, it } from "vitest";

import { createKaenmaClient } from "./index";

describe("createKaenmaClient", () => {
  it("sends a workspace-scoped bearer token to /api/v1", async () => {
    let authorization = "";
    let url = "";
    const client = createKaenmaClient({
      baseUrl: "https://kaenma.example",
      apiKey: "kaenma_abcdefghijkl_secret-secret-secret-secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        authorization = request.headers.get("authorization") ?? "";
        url = request.url;
        return Response.json([]);
      },
    });
    await client.segments.list();
    expect(authorization).toBe("Bearer kaenma_abcdefghijkl_secret-secret-secret-secret");
    expect(url).toBe("https://kaenma.example/api/v1/segments");
  });

  it("surfaces contract-defined errors as typed ORPCErrors", async () => {
    const client = createKaenmaClient({
      baseUrl: "https://kaenma.example",
      apiKey: "kaenma_abcdefghijkl_secret-secret-secret-secret",
      fetch: async () =>
        Response.json(
          { defined: true, code: "UNAUTHORIZED", status: 401, message: "ログインが必要です" },
          { status: 401 },
        ),
    });
    await expect(client.workspace.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      defined: true,
    });
  });
});

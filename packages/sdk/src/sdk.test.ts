import { describe, expect, it } from "vitest";

import { KaenmaClient } from "./index";

describe("KaenmaClient", () => {
  it("sends a workspace-scoped bearer token", async () => {
    let authorization = "";
    const client = new KaenmaClient({
      baseUrl: "https://kaenma.example",
      apiKey: "kaenma_abcdefghijkl_secret-secret-secret-secret",
      fetcher: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ data: [] });
      },
    });
    await client.contacts.list();
    expect(authorization).toContain("kaenma_");
  });
});

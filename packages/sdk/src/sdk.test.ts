import { describe, expect, it } from "vitest";

import { createOpenEngageClient } from "./index";

describe("createOpenEngageClient", () => {
  it("sends a workspace-scoped bearer token to /api/v1", async () => {
    let authorization = "";
    let url = "";
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "openengage_abcdefghijkl_secret-secret-secret-secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        authorization = request.headers.get("authorization") ?? "";
        url = request.url;
        return Response.json([]);
      },
    });
    await client.segments.list();
    expect(authorization).toBe("Bearer openengage_abcdefghijkl_secret-secret-secret-secret");
    expect(url).toBe("https://openengage.example/api/v1/segments");
  });

  it("surfaces contract-defined errors as typed ORPCErrors", async () => {
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "openengage_abcdefghijkl_secret-secret-secret-secret",
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

  it("uses the v0.1 domain namespace and REST path", async () => {
    let method = "";
    let url = "";
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "openengage_abcdefghijkl_secret-secret-secret-secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        method = request.method;
        url = request.url;
        return Response.json({ jobId: "job-id" }, { status: 202 });
      },
    });

    await client.contacts.startExport();

    expect(method).toBe("POST");
    expect(url).toBe("https://openengage.example/api/v1/contacts/exports");
  });
});

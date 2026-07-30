import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@kaenma/database";

import { sha256Hex } from "../src/crypto";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("Deals CRM", () => {
  it("manages a deal through its pipeline and task lifecycle", async () => {
    const workspaceId = uuidv7();
    const userId = uuidv7();
    const apiKeyId = uuidv7();
    const prefix = "dealskey0001";
    const token = `kaenma_${prefix}_abcdefghijklmnopqrstuvwx`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user
         (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, 'Deal Owner', ?, 1, ?, ?)`,
      ).bind(userId, `${userId}@example.com`, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO organization (id, name, slug, created_at, timezone)
         VALUES (?, 'Deal Workspace', ?, ?, 'Asia/Tokyo')`,
      ).bind(workspaceId, `deals-${workspaceId}`, Date.now()),
      env.DB.prepare(
        `INSERT INTO member
         (id, organization_id, user_id, role, created_at)
         VALUES (?, ?, ?, 'owner', ?)`,
      ).bind(uuidv7(), workspaceId, userId, Date.now()),
      env.DB.prepare(
        `INSERT INTO api_keys
         (id, workspace_id, created_by_user_id, name, prefix, key_hash, role, created_at)
         VALUES (?, ?, ?, 'Deals test', ?, ?, 'owner', ?)`,
      ).bind(apiKeyId, workspaceId, userId, prefix, await sha256Hex(token), now),
    ]);

    const call = (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("content-type", "application/json");
      return exports.default.fetch(
        new Request(`http://localhost:8787/api/v1${path}`, {
          ...init,
          headers,
        }),
      );
    };

    const optionsResponse = await call("/deal-options");
    expect(optionsResponse.status).toBe(200);
    const options = (await optionsResponse.json()) as {
      data: {
        pipelines: Array<{
          id: string;
          isDefault: boolean;
          stages: Array<{ id: string; name: string; position: number }>;
        }>;
        members: Array<{ id: string }>;
      };
    };
    expect(options.data.pipelines).toHaveLength(1);
    expect(options.data.pipelines[0]?.isDefault).toBe(true);
    expect(options.data.pipelines[0]?.stages.map((stage) => stage.name)).toEqual([
      "新規",
      "連絡済み",
      "提案",
      "交渉",
      "最終確認",
    ]);
    expect(options.data.members).toEqual([expect.objectContaining({ id: userId })]);

    const pipeline = options.data.pipelines[0]!;
    const firstStage = pipeline.stages[0]!;
    const secondStage = pipeline.stages[1]!;
    const accountResponse = await call("/accounts", {
      method: "POST",
      body: JSON.stringify({ name: "Acme株式会社", domain: "acme.example" }),
    });
    expect(accountResponse.status).toBe(201);
    const account = (await accountResponse.json()) as { data: { id: string } };
    const contactResponse = await call("/contacts", {
      method: "POST",
      body: JSON.stringify({
        email: "buyer@acme.example",
        firstName: "花子",
        lastName: "営業",
      }),
    });
    expect(contactResponse.status).toBe(201);
    const contact = (await contactResponse.json()) as { data: { id: string } };

    const createResponse = await call("/deals", {
      method: "POST",
      body: JSON.stringify({
        name: "Acme MA導入",
        pipelineId: pipeline.id,
        stageId: firstStage.id,
        value: 1_500_000,
        currency: "JPY",
        ownerUserId: userId,
        contactId: contact.data.id,
        accountId: account.data.id,
        expectedCloseDate: "2026-09-30",
        description: "提案準備中",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      data: { id: string; status: string; stageId: string; accountName: string };
    };
    expect(created.data).toMatchObject({
      status: "open",
      stageId: firstStage.id,
      accountName: "Acme株式会社",
    });

    const invalidMove = await call(`/deals/${created.data.id}/move`, {
      method: "POST",
      body: JSON.stringify({ stageId: uuidv7() }),
    });
    expect(invalidMove.status).toBe(422);
    const moveResponse = await call(`/deals/${created.data.id}/move`, {
      method: "POST",
      body: JSON.stringify({ stageId: secondStage.id }),
    });
    expect(moveResponse.status).toBe(200);
    expect(await moveResponse.json()).toMatchObject({
      data: { stageId: secondStage.id, stageName: "連絡済み" },
    });

    const taskResponse = await call(`/deals/${created.data.id}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "提案内容を電話で確認",
        type: "call",
        dueAt: "2026-08-01T03:00:00.000Z",
        assignedUserId: userId,
      }),
    });
    expect(taskResponse.status).toBe(201);
    const task = (await taskResponse.json()) as {
      data: { id: string; status: string; type: string };
    };
    expect(task.data).toMatchObject({ status: "open", type: "call" });
    const completeResponse = await call(`/deals/${created.data.id}/tasks/${task.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    expect(completeResponse.status).toBe(200);
    expect(await completeResponse.json()).toMatchObject({
      data: { status: "completed", completedAt: expect.any(String) },
    });

    const wonResponse = await call(`/deals/${created.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "won" }),
    });
    expect(wonResponse.status).toBe(200);
    expect(await wonResponse.json()).toMatchObject({
      data: { status: "won", wonAt: expect.any(String), lostAt: null },
    });

    const list = (await (await call(`/deals?pipelineId=${pipeline.id}&status=all`)).json()) as {
      data: {
        items: Array<{ id: string }>;
        summary: { openCount: number; wonCount: number; wonValue: number };
      };
    };
    expect(list.data.items).toEqual([expect.objectContaining({ id: created.data.id })]);
    expect(list.data.summary).toMatchObject({
      openCount: 0,
      wonCount: 1,
      wonValue: 1_500_000,
    });

    const detail = (await (await call(`/deals/${created.data.id}`)).json()) as {
      data: { tasks: Array<{ id: string; status: string }> };
    };
    expect(detail.data.tasks).toEqual([
      expect.objectContaining({ id: task.data.id, status: "completed" }),
    ]);
    expect((await call(`/deals/${created.data.id}/archive`, { method: "POST" })).status).toBe(200);
    expect((await call(`/deals/${created.data.id}`)).status).toBe(404);
  });
});

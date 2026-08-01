import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@kaenma/database";
import { contract } from "@kaenma/orpc";

import { sha256Hex } from "../src/platform/crypto";

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

    const link = new RPCLink({
      url: "http://localhost:8787/api/rpc",
      headers: { authorization: `Bearer ${token}` },
      fetch: (request) => exports.default.fetch(request),
    });
    const client: ContractRouterClient<typeof contract> = createORPCClient(link);

    const options = await client.deals.options();
    expect(options.pipelines).toHaveLength(1);
    expect(options.pipelines[0]?.isDefault).toBe(true);
    expect(options.pipelines[0]?.stages.map((stage) => stage.name)).toEqual([
      "新規",
      "連絡済み",
      "提案",
      "交渉",
      "最終確認",
    ]);
    expect(options.members).toEqual([expect.objectContaining({ id: userId })]);

    const pipeline = options.pipelines[0]!;
    const firstStage = pipeline.stages[0]!;
    const secondStage = pipeline.stages[1]!;
    const account = await client.accounts.create({
      name: "Acme株式会社",
      domain: "acme.example",
    });
    const contact = await client.contacts.create({
      email: "buyer@acme.example",
      firstName: "花子",
      lastName: "営業",
      customFields: {},
    });

    const created = await client.deals.create({
      name: "Acme MA導入",
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      value: 1_500_000,
      currency: "JPY",
      ownerUserId: userId,
      contactId: contact.id,
      accountId: account.id,
      expectedCloseDate: "2026-09-30",
      description: "提案準備中",
    });
    expect(created).toMatchObject({
      status: "open",
      stageId: firstStage.id,
      accountName: "Acme株式会社",
    });

    await expect(client.deals.move({ id: created.id, stageId: uuidv7() })).rejects.toMatchObject({
      code: "INVALID_DEAL_STAGE",
      status: 422,
    });
    await expect(
      client.deals.move({ id: created.id, stageId: secondStage.id }),
    ).resolves.toMatchObject({ stageId: secondStage.id, stageName: "連絡済み" });

    const task = await client.deals.createTask({
      dealId: created.id,
      title: "提案内容を電話で確認",
      type: "call",
      dueAt: "2026-08-01T03:00:00.000Z",
      assignedUserId: userId,
    });
    expect(task).toMatchObject({ status: "open", type: "call" });
    await expect(
      client.deals.updateTask({ dealId: created.id, taskId: task.id, status: "completed" }),
    ).resolves.toMatchObject({ status: "completed", completedAt: expect.any(String) });

    await expect(client.deals.update({ id: created.id, status: "won" })).resolves.toMatchObject({
      status: "won",
      wonAt: expect.any(String),
      lostAt: null,
    });

    const list = await client.deals.list({ pipelineId: pipeline.id, status: "all" });
    expect(list.items).toEqual([expect.objectContaining({ id: created.id })]);
    expect(list.summary).toMatchObject({
      openCount: 0,
      wonCount: 1,
      wonValue: 1_500_000,
    });

    const detail = await client.deals.get({ id: created.id });
    expect(detail.tasks).toEqual([expect.objectContaining({ id: task.id, status: "completed" })]);
    await expect(client.deals.archive({ id: created.id })).resolves.toEqual({ archived: true });
    await expect(client.deals.get({ id: created.id })).rejects.toMatchObject({
      code: "DEAL_NOT_FOUND",
      status: 404,
    });
  });
});

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { uuidv7 } from "@openengage/database";

import { seedMember, seedWorkspaceClient } from "./factory";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

describe("Deals CRM", () => {
  it("manages a deal through its pipeline and task lifecycle", async () => {
    const { client, workspaceId, userId } = await seedWorkspaceClient(env.DB, {
      timezone: "Asia/Tokyo",
    });
    await seedMember(env.DB, { workspaceId, userId });

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
    const account = await client.companies.create({
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
      companyId: account.id,
      expectedCloseDate: "2026-09-30",
      description: "提案準備中",
    });
    expect(created).toMatchObject({
      status: "open",
      stageId: firstStage.id,
      companyName: "Acme株式会社",
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

import { describe, expect, it } from "vitest";

import {
  dealCreateSchema,
  dealMoveSchema,
  dealTaskCreateSchema,
  dealTaskUpdateSchema,
  dealUpdateSchema,
} from "./schema";

describe("deal schemas", () => {
  const validDeal = {
    name: "Acme MA導入",
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    value: 1_200_000,
    currency: "jpy",
    ownerUserId: null,
    contactId: null,
    accountId: null,
    expectedCloseDate: "2026-09-30",
    description: "導入条件を確認中",
  };

  it("normalizes a valid deal", () => {
    expect(dealCreateSchema.parse(validDeal)).toMatchObject({
      currency: "JPY",
      status: "open",
      value: 1_200_000,
    });
  });

  it("rejects invalid values, currencies, and dates", () => {
    expect(dealCreateSchema.safeParse({ ...validDeal, value: -1 }).success).toBe(false);
    expect(dealCreateSchema.safeParse({ ...validDeal, currency: "JP" }).success).toBe(false);
    expect(
      dealCreateSchema.safeParse({ ...validDeal, expectedCloseDate: "2026-02-30" }).success,
    ).toBe(false);
  });

  it("validates stage movement", () => {
    expect(dealMoveSchema.safeParse({ stageId: "stage-2" }).success).toBe(true);
    expect(dealMoveSchema.safeParse({ stageId: "" }).success).toBe(false);
  });

  it("validates task creation and status updates", () => {
    expect(
      dealTaskCreateSchema.parse({
        title: "提案書を送付",
        type: "email",
        dueAt: "2026-08-01T03:00:00.000Z",
      }),
    ).toMatchObject({
      type: "email",
      notes: "",
    });
    expect(dealTaskCreateSchema.safeParse({ title: "", type: "call" }).success).toBe(false);
    expect(dealTaskUpdateSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(dealTaskUpdateSchema.safeParse({ status: "cancelled" }).success).toBe(false);
  });

  it("does not apply create defaults to partial updates", () => {
    expect(dealUpdateSchema.parse({ status: "won" })).toEqual({ status: "won" });
    expect(dealTaskUpdateSchema.parse({ status: "completed" })).toEqual({
      status: "completed",
    });
  });
});

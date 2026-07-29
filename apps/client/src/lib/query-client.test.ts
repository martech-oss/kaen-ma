import { dehydrate, hydrate } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "@/lib/query-client";

describe("query client", () => {
  it("preserves oRPC values through dehydration and hydration", () => {
    const timestamp = new Date("2026-07-29T00:00:00.000Z");
    const source = createQueryClient();
    source.setQueryData(["snapshot", timestamp], {
      createdAt: timestamp,
    });

    const target = createQueryClient();
    hydrate(target, dehydrate(source));

    expect(target.getQueryData<{ createdAt: Date }>(["snapshot", timestamp])).toEqual({
      createdAt: timestamp,
    });
  });
});

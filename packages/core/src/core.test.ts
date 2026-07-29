import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "@kaenma/shared";
import {
  canTransitionJob,
  compileSegmentFilter,
  evaluateSendEligibility,
  retryDelaySeconds,
  validateCampaign,
} from "./index.js";

describe("campaign validation", () => {
  it("rejects cycles and Cloudflare marketing sends", () => {
    const definition: CampaignDefinition = {
      name: "bad",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created" },
        },
        {
          id: "send",
          type: "action",
          position: { x: 0, y: 100 },
          config: {
            action: "send_email",
            templateVersionId: "template",
            purpose: "marketing",
            provider: "cloudflare",
          },
        },
      ],
      edges: [
        { id: "one", source: "source", target: "send", branch: "next" },
        { id: "two", source: "send", target: "source", branch: "next" },
      ],
    };
    expect(validateCampaign(definition).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["cycle", "marketing_provider_mismatch"]),
    );
  });

  it("accepts Resend for a marketing email action", () => {
    const definition: CampaignDefinition = {
      name: "resend campaign",
      description: "",
      timezone: "UTC",
      nodes: [
        {
          id: "source",
          type: "source",
          position: { x: 0, y: 0 },
          config: { source: "contact_created" },
        },
        {
          id: "send",
          type: "action",
          position: { x: 0, y: 100 },
          config: {
            action: "send_email",
            templateVersionId: "template",
            purpose: "marketing",
            provider: "resend",
          },
        },
      ],
      edges: [{ id: "one", source: "source", target: "send", branch: "next" }],
    };
    expect(validateCampaign(definition)).toEqual([]);
  });
});

describe("segment compiler", () => {
  it("binds values and never interpolates user input", () => {
    const result = compileSegmentFilter("workspace", {
      kind: "group",
      combinator: "and",
      children: [
        {
          kind: "condition",
          field: "email",
          operator: "contains",
          value: "' OR 1=1 --",
        },
        {
          kind: "condition",
          field: "score",
          operator: "gte",
          value: 10,
        },
      ],
    });
    expect(result.sql).not.toContain("' OR 1=1");
    expect(result.params).toEqual(["workspace", "%' OR 1=1 --%", 10]);
  });
});

describe("delivery safeguards", () => {
  it("blocks marketing after unsubscribe but permits transactional mail", () => {
    const snapshot = {
      globalStatus: "unsubscribed" as const,
      suppressed: false,
      frequency: { sentInWindow: 0, limit: null },
    };
    expect(evaluateSendEligibility("marketing", snapshot)).toEqual({
      allowed: false,
      reason: "global_unsubscribed",
    });
    expect(evaluateSendEligibility("transactional", snapshot)).toEqual({ allowed: true });
  });

  it("blocks every delivery to an archived contact", () => {
    const snapshot = {
      contactStatus: "archived" as const,
      globalStatus: "subscribed" as const,
      suppressed: false,
      frequency: { sentInWindow: 0, limit: null },
    };
    expect(evaluateSendEligibility("marketing", snapshot)).toEqual({
      allowed: false,
      reason: "contact_archived",
    });
    expect(evaluateSendEligibility("transactional", snapshot)).toEqual({
      allowed: false,
      reason: "contact_archived",
    });
  });

  it("defines bounded retries and valid transitions", () => {
    expect(canTransitionJob("processing", "completed")).toBe(true);
    expect(canTransitionJob("completed", "pending")).toBe(false);
    expect(retryDelaySeconds(20)).toBe(3_600);
  });
});

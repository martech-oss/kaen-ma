import type { AutomationDefinition } from "@openengage/core/automations";
import { describe, expect, it } from "vitest";

import { automationBuilderReducer } from "./use-automation-builder";

const definition: AutomationDefinition = {
  name: "Welcome",
  description: "",
  timezone: "Asia/Tokyo",
  nodes: [
    {
      id: "source",
      type: "source",
      position: { x: 0, y: 0 },
      config: { source: "contact_created", reentry: "once" },
    },
  ],
  edges: [],
};

describe("automationBuilderReducer", () => {
  it("replaces the graph without losing node selection", () => {
    const state = automationBuilderReducer(
      { definition, selectedNodeId: "source" },
      { type: "replace_definition", definition: { ...definition, name: "Updated" } },
    );

    expect(state.definition.name).toBe("Updated");
    expect(state.selectedNodeId).toBe("source");
  });

  it("updates graph and selection atomically when adding or deleting a node", () => {
    const state = automationBuilderReducer(
      { definition, selectedNodeId: "source" },
      {
        type: "replace_and_select",
        definition: { ...definition, nodes: [] },
        nodeId: null,
      },
    );

    expect(state.definition.nodes).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
  });
});

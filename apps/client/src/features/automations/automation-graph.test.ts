import { describe, expect, it } from "vitest";

import type { AutomationDefinition, AutomationEdge, AutomationNode } from "@kaenma/orpc";

import {
  chainEdges,
  connectionBranches,
  connectionCreatesCycle,
  isBranch,
  toAutomationEdge,
  withAutomationConnection,
} from "./automation-graph";

const at = { x: 0, y: 0 };

function sourceNode(id: string): AutomationNode {
  return {
    id,
    type: "source",
    position: at,
    config: { source: "contact_created", reentry: "once" },
  };
}

function actionNode(id: string): AutomationNode {
  return {
    id,
    type: "action",
    position: at,
    config: { action: "add_tag", tagId: "tag-1" },
  };
}

function conditionNode(id: string): AutomationNode {
  return {
    id,
    type: "condition",
    position: at,
    config: { field: "email", operator: "exists", value: null },
  };
}

function edge(
  source: string,
  target: string,
  branch: AutomationEdge["branch"] = "next",
): AutomationEdge {
  return { id: `${source}-${target}-${branch}`, source, target, branch };
}

function definition(nodes: AutomationNode[], edges: AutomationEdge[]): AutomationDefinition {
  return { name: "t", description: "", timezone: "UTC", nodes, edges };
}

describe("chainEdges", () => {
  it("links each id to the next one", () => {
    expect(chainEdges(["a", "b", "c"])).toEqual([
      { id: "a-b", source: "a", target: "b", branch: "next" },
      { id: "b-c", source: "b", target: "c", branch: "next" },
    ]);
  });

  it("produces no edges for fewer than two ids", () => {
    expect(chainEdges([])).toEqual([]);
    expect(chainEdges(["only"])).toEqual([]);
  });
});

describe("connectionBranches", () => {
  it("offers yes/no for a condition and yes/timeout for a decision", () => {
    expect(connectionBranches(conditionNode("c")).map(([branch]) => branch)).toEqual(["yes", "no"]);
    expect(
      connectionBranches({
        id: "d",
        type: "decision",
        position: at,
        config: { event: "opened", withinMinutes: 60 },
      }).map(([branch]) => branch),
    ).toEqual(["yes", "timeout"]);
  });

  it("offers only next for other node types", () => {
    expect(connectionBranches(actionNode("a")).map(([branch]) => branch)).toEqual(["next"]);
    expect(connectionBranches(sourceNode("s")).map(([branch]) => branch)).toEqual(["next"]);
  });
});

describe("connectionCreatesCycle", () => {
  it("detects a direct back-edge", () => {
    expect(connectionCreatesCycle([edge("b", "a")], "a", "b")).toBe(true);
  });

  it("detects a cycle through intermediate nodes", () => {
    const edges = [edge("b", "c"), edge("c", "d"), edge("d", "a")];
    expect(connectionCreatesCycle(edges, "a", "b")).toBe(true);
  });

  it("allows a connection that keeps the graph acyclic", () => {
    expect(connectionCreatesCycle([edge("b", "c")], "a", "b")).toBe(false);
  });

  it("allows a diamond, where two branches rejoin without looping", () => {
    const edges = [edge("a", "b", "yes"), edge("a", "c", "no"), edge("b", "d")];
    expect(connectionCreatesCycle(edges, "c", "d")).toBe(false);
  });

  it("terminates on a graph that already contains a cycle", () => {
    const edges = [edge("b", "c"), edge("c", "b")];
    expect(connectionCreatesCycle(edges, "a", "b")).toBe(false);
  });
});

describe("withAutomationConnection", () => {
  const nodes = [sourceNode("s"), actionNode("a"), actionNode("b")];

  it("adds an edge on a valid branch", () => {
    const result = withAutomationConnection(definition(nodes, []), "s", "a", "next");
    expect(result?.edges).toHaveLength(1);
    expect(result?.edges[0]).toMatchObject({ source: "s", target: "a", branch: "next" });
  });

  it("replaces the existing edge for the same source and branch, keeping its id", () => {
    const existing = edge("s", "a");
    const result = withAutomationConnection(definition(nodes, [existing]), "s", "b", "next");
    expect(result?.edges).toHaveLength(1);
    expect(result?.edges[0]).toMatchObject({ id: existing.id, target: "b" });
  });

  it("removes the edge when the target is null", () => {
    const result = withAutomationConnection(definition(nodes, [edge("s", "a")]), "s", null, "next");
    expect(result?.edges).toEqual([]);
  });

  it("rejects a branch the source node does not offer", () => {
    expect(withAutomationConnection(definition(nodes, []), "a", "b", "timeout")).toBeNull();
  });

  it("rejects an unknown source or target", () => {
    expect(withAutomationConnection(definition(nodes, []), "missing", "a", "next")).toBeNull();
    expect(withAutomationConnection(definition(nodes, []), "s", "missing", "next")).toBeNull();
  });

  it("rejects targeting a source node, which cannot be entered", () => {
    expect(withAutomationConnection(definition(nodes, []), "a", "s", "next")).toBeNull();
  });

  it("rejects a connection that would create a cycle", () => {
    const withPath = definition(nodes, [edge("a", "b")]);
    expect(withAutomationConnection(withPath, "b", "a", "next")).toBeNull();
  });
});

describe("isBranch", () => {
  it("accepts the four branch names and nothing else", () => {
    for (const value of ["next", "yes", "no", "timeout"]) expect(isBranch(value)).toBe(true);
    for (const value of ["", "maybe", null, undefined]) expect(isBranch(value)).toBe(false);
  });
});

describe("toAutomationEdge", () => {
  it("reads the branch out of edge data", () => {
    expect(
      toAutomationEdge({ id: "e", source: "a", target: "b", data: { branch: "yes" } }),
    ).toEqual({
      id: "e",
      source: "a",
      target: "b",
      branch: "yes",
    });
  });

  it("falls back to next when the branch is missing or invalid", () => {
    expect(toAutomationEdge({ id: "e", source: "a", target: "b" }).branch).toBe("next");
    expect(
      toAutomationEdge({ id: "e", source: "a", target: "b", data: { branch: "bogus" } }).branch,
    ).toBe("next");
  });
});

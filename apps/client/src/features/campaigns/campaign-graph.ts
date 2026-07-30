import { type Edge } from "@xyflow/react";

import { type CampaignDefinition, type CampaignEdge, type CampaignNode } from "@kaenma/shared";

import { type EmailTemplateOption } from "./campaign-types";

export function chainEdges(ids: string[]): CampaignEdge[] {
  return ids.slice(1).map((target, index) => ({
    id: `${ids[index]}-${target}`,
    source: ids[index]!,
    target,
    branch: "next",
  }));
}

export function connectionBranches(
  node: CampaignNode,
): Array<readonly [CampaignEdge["branch"], string]> {
  if (node.type === "condition") {
    return [
      ["yes", "はい"],
      ["no", "いいえ"],
    ];
  }
  if (node.type === "decision") {
    return [
      ["yes", "はい"],
      ["timeout", "時間切れ"],
    ];
  }
  return [["next", "次へ"]];
}

export function withCampaignConnection(
  definition: CampaignDefinition,
  sourceId: string,
  targetId: string | null,
  branch: CampaignEdge["branch"],
): CampaignDefinition | null {
  const source = definition.nodes.find((node) => node.id === sourceId);
  const target = targetId
    ? definition.nodes.find((node) => node.id === targetId && node.type !== "source")
    : null;
  if (
    !source ||
    (targetId && !target) ||
    !connectionBranches(source).some(([candidate]) => candidate === branch)
  ) {
    return null;
  }

  const existing = definition.edges.find(
    (edge) => edge.source === sourceId && edge.branch === branch,
  );
  const edges = definition.edges.filter(
    (edge) => !(edge.source === sourceId && edge.branch === branch),
  );
  if (!targetId) return { ...definition, edges };
  if (connectionCreatesCycle(edges, sourceId, targetId)) return null;

  return {
    ...definition,
    edges: [
      ...edges,
      {
        id: existing?.id ?? crypto.randomUUID(),
        source: sourceId,
        target: targetId,
        branch,
      },
    ],
  };
}

export function connectionCreatesCycle(
  edges: CampaignEdge[],
  sourceId: string,
  targetId: string,
): boolean {
  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.source === current) pending.push(edge.target);
    }
  }
  return false;
}

export function isBranch(value: string | null | undefined): value is CampaignEdge["branch"] {
  return value === "next" || value === "yes" || value === "no" || value === "timeout";
}

export function toCampaignEdge(edge: Edge): CampaignEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    branch: isBranch(edge.data?.["branch"] as string | undefined)
      ? (edge.data?.["branch"] as CampaignEdge["branch"])
      : "next",
  };
}

export function sourceNode(
  config: Extract<CampaignNode, { type: "source" }>["config"],
  x: number,
  y: number,
): Extract<CampaignNode, { type: "source" }> {
  return { id: "source", type: "source", position: { x, y }, config };
}

export function emailNode(
  id: string,
  position: { x: number; y: number },
  template: EmailTemplateOption,
): Extract<CampaignNode, { type: "action" }> {
  return {
    id,
    type: "action",
    position,
    config: {
      action: "send_email",
      templateId: template.id,
    },
  };
}

export function delayNode(
  id: string,
  minutes: number,
  x: number,
  y: number,
): Extract<CampaignNode, { type: "delay" }> {
  return { id, type: "delay", position: { x, y }, config: { mode: "relative", minutes } };
}

export function sourceConfig(
  source: string,
  formId: string,
  segmentId: string,
): Extract<CampaignNode, { type: "source" }>["config"] {
  if (source === "form_submitted") return { source, formId, reentry: "once" };
  if (source === "segment_joined") return { source, segmentId, reentry: "once" };
  if (source === "api_event") return { source, eventName: "custom_event", reentry: "every_time" };
  if (source === "webhook_event")
    return { source, eventName: "custom_event", reentry: "every_time" };
  if (source === "contact_inactive") return { source, days: 30, reentry: "once" };
  return { source: "contact_created", reentry: "once" };
}

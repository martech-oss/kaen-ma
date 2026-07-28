import type {
  CampaignDefinition,
  CampaignEdge,
  CampaignNode,
} from "@kaenma/shared";

export interface CampaignValidationIssue {
  code:
    | "duplicate_node"
    | "duplicate_edge"
    | "missing_source"
    | "multiple_sources"
    | "missing_endpoint"
    | "cycle"
    | "unreachable"
    | "invalid_branch"
    | "marketing_provider_mismatch";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const branchesByNodeType: Record<CampaignNode["type"], ReadonlySet<CampaignEdge["branch"]>> = {
  source: new Set(["next"]),
  action: new Set(["next"]),
  delay: new Set(["next"]),
  condition: new Set(["yes", "no"]),
  decision: new Set(["yes", "no", "timeout"]),
};

export function validateCampaign(
  definition: CampaignDefinition,
): CampaignValidationIssue[] {
  const issues: CampaignValidationIssue[] = [];
  const nodes = new Map<string, CampaignNode>();
  const edgeIds = new Set<string>();

  for (const node of definition.nodes) {
    if (nodes.has(node.id)) {
      issues.push({
        code: "duplicate_node",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      });
    }
    nodes.set(node.id, node);
    if (
      node.type === "action" &&
      node.config.action === "send_email" &&
      node.config.purpose === "marketing" &&
      node.config.provider !== "postmark"
    ) {
      issues.push({
        code: "marketing_provider_mismatch",
        message: "Marketing email must use the Postmark adapter",
        nodeId: node.id,
      });
    }
  }

  const sources = definition.nodes.filter((node) => node.type === "source");
  if (sources.length === 0) {
    issues.push({ code: "missing_source", message: "Campaign requires one source node" });
  } else if (sources.length > 1) {
    issues.push({
      code: "multiple_sources",
      message: "Campaign must have exactly one source node",
    });
  }

  const adjacency = new Map<string, string[]>();
  for (const node of definition.nodes) adjacency.set(node.id, []);

  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: "duplicate_edge",
        message: `Duplicate edge id: ${edge.id}`,
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      issues.push({
        code: "missing_endpoint",
        message: `Edge ${edge.id} references a missing node`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!branchesByNodeType[source.type].has(edge.branch)) {
      issues.push({
        code: "invalid_branch",
        message: `Branch ${edge.branch} is invalid for ${source.type}`,
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
    adjacency.get(source.id)?.push(target.id);
  }

  const sourceId = sources[0]?.id;
  if (sourceId) {
    const reachable = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (nodeId: string): void => {
      if (visiting.has(nodeId)) {
        issues.push({
          code: "cycle",
          message: `Campaign contains a cycle at ${nodeId}`,
          nodeId,
        });
        return;
      }
      if (visited.has(nodeId)) return;
      visiting.add(nodeId);
      reachable.add(nodeId);
      for (const child of adjacency.get(nodeId) ?? []) walk(child);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    walk(sourceId);
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: "unreachable",
          message: `Node ${node.id} cannot be reached from the source`,
          nodeId: node.id,
        });
      }
    }
  }

  return deduplicateIssues(issues);
}

function deduplicateIssues(
  issues: CampaignValidationIssue[],
): CampaignValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.nodeId ?? ""}:${issue.edgeId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function outgoingEdges(
  definition: CampaignDefinition,
  nodeId: string,
  branch?: CampaignEdge["branch"],
): CampaignEdge[] {
  return definition.edges.filter(
    (edge) =>
      edge.source === nodeId && (branch === undefined || edge.branch === branch),
  );
}


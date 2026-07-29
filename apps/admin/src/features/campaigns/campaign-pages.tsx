import type {
  CampaignDefinition,
  CampaignEdge,
  CampaignNode,
} from "@kaenma/shared";
import { rpc } from "@/rpc";
import {
  PageLayout,
  ResourceCard,
  ResourceGrid,
  SimpleEmpty,
} from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { GitBranch, Plus, Save, Send } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

export interface CampaignRow {
  id: string;
  name: string;
  description: string;
  status: string;
  updated_at: string;
}

export function CampaignsPage({
  campaigns,
}: {
  campaigns: CampaignRow[];
}): ReactNode {
  const navigate = useNavigate();

  async function createCampaign(): Promise<void> {
    const definition = createStarterCampaign(
      `New campaign ${campaigns.length + 1}`,
    );
    const response = await rpc<{ id: string }>("/campaigns", {
      method: "POST",
      body: JSON.stringify(definition),
    });
    await navigate({
      to: "/campaigns/$id",
      params: { id: response.data.id },
    });
  }

  return (
    <PageLayout
      title="キャンペーン"
      action={
        <Button onClick={() => void createCampaign()}>
          <Plus data-icon="inline-start" />
          キャンペーンを作成
        </Button>
      }
    >
      <ResourceGrid>
        {campaigns.map((campaign) => (
          <Button
            key={campaign.id}
            variant="ghost"
            className="h-auto w-full items-stretch p-0 text-left"
            onClick={() => {
              void navigate({
                to: "/campaigns/$id",
                params: { id: campaign.id },
              });
            }}
          >
            <ResourceCard
              icon={<GitBranch />}
              title={campaign.name}
              subtitle={campaign.status}
              footer={formatDateTime(campaign.updated_at)}
            />
          </Button>
        ))}
      </ResourceGrid>
      {campaigns.length === 0 ? (
        <SimpleEmpty label="最初のキャンペーンを作成しましょう" />
      ) : null}
    </PageLayout>
  );
}

export function CampaignBuilder({
  id,
  initialDefinition,
}: {
  id: string;
  initialDefinition: CampaignDefinition;
}): ReactNode {
  const [definition, setDefinition] =
    useState<CampaignDefinition>(initialDefinition);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const flowNodes: Node[] = useMemo(
    () =>
      definition.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        type: "campaign",
        width: 160,
        height: 66,
        data: { node },
      })),
    [definition],
  );
  const flowEdges: Edge[] = useMemo(
    () =>
      definition.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.branch === "next" ? undefined : edge.branch,
        data: { branch: edge.branch },
      })),
    [definition],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const changed = applyNodeChanges(changes, flowNodes);
      setDefinition((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          const flow = changed.find((item) => item.id === node.id);
          return flow ? { ...node, position: flow.position } : node;
        }),
      }));
    },
    [flowNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const changed = applyEdgeChanges(changes, flowEdges);
      setDefinition((current) => ({
        ...current,
        edges: changed.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          branch:
            (edge.data?.["branch"] as CampaignEdge["branch"] | undefined) ??
            "next",
        })),
      }));
    },
    [flowEdges],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      setDefinition((current) => {
        const source = current.nodes.find(
          (node) => node.id === connection.source,
        );
        const branch: CampaignEdge["branch"] =
          source?.type === "condition" || source?.type === "decision"
            ? "yes"
            : "next";
        const added = addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            data: { branch },
          },
          flowEdges,
        );
        return {
          ...current,
          edges: added.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            branch:
              (edge.data?.["branch"] as CampaignEdge["branch"] | undefined) ??
              "next",
          })),
        };
      });
    },
    [flowEdges],
  );

  async function save(publish = false): Promise<void> {
    setSaving(true);
    setNotice("");
    try {
      await rpc(`/campaigns/${id}/draft`, {
        method: "PUT",
        body: JSON.stringify(definition),
      });
      if (publish) {
        await rpc(`/campaigns/${id}/publish`, { method: "POST" });
        setNotice("新しい不変バージョンを公開しました");
        toast.success("キャンペーンを公開しました");
      } else {
        setNotice("下書きを保存しました");
        toast.success("下書きを保存しました");
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "保存できませんでした",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="-m-4 lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-4 lg:px-8">
        <div>
          <Input
            aria-label="キャンペーン名"
            className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
            value={definition.name}
            onChange={(event) =>
              setDefinition((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
          <div className="text-xs text-muted-foreground">
            Draft · {definition.timezone}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {notice ? (
            <span className="text-sm text-muted-foreground">{notice}</span>
          ) : null}
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void save()}
          >
            <Save data-icon="inline-start" />
            保存
          </Button>
          <Button disabled={saving} onClick={() => void save(true)}>
            <Send data-icon="inline-start" />
            公開
          </Button>
        </div>
      </div>
      <div className="h-[calc(100vh-8.5rem)] bg-muted/60">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={campaignNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background color="#cbd5e1" gap={24} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

function CampaignFlowNode({
  data,
}: NodeProps<Node<{ node: CampaignNode }>>): ReactNode {
  const node = data.node;
  const colors: Record<CampaignNode["type"], string> = {
    source: "border-success",
    action: "border-primary",
    condition: "border-warning",
    decision: "border-foreground",
    delay: "border-muted-foreground",
  };
  const label =
    node.type === "action"
      ? node.config.action.replaceAll("_", " ")
      : node.type === "source"
        ? node.config.source.replaceAll("_", " ")
        : node.type;

  return (
    <Card
      size="sm"
      className={cn("min-w-40 border-2 py-3 shadow-md", colors[node.type])}
    >
      {node.type !== "source" ? (
        <Handle type="target" position={Position.Left} />
      ) : null}
      <CardHeader>
        <CardDescription className="text-[10px] font-semibold uppercase tracking-widest">
          {node.type}
        </CardDescription>
        <CardTitle className="capitalize">{label}</CardTitle>
      </CardHeader>
      <Handle type="source" position={Position.Right} />
    </Card>
  );
}

const campaignNodeTypes = { campaign: CampaignFlowNode };

function createStarterCampaign(name: string): CampaignDefinition {
  return {
    name,
    description: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    nodes: [
      {
        id: "source",
        type: "source",
        position: { x: 80, y: 180 },
        config: { source: "contact_created" },
      },
      {
        id: "score",
        type: "action",
        position: { x: 380, y: 180 },
        config: { action: "change_score", amount: 5 },
      },
    ],
    edges: [
      { id: "source-score", source: "source", target: "score", branch: "next" },
    ],
  };
}

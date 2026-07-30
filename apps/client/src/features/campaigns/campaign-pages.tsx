import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  Activity,
  Clock3,
  GitBranch,
  Mail,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AppDialog,
  FormInput,
  FormNativeSelect,
  FormSelectOption,
  PageLayout,
  SimpleEmpty,
} from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rpc } from "@/rpc";
import type { CampaignDefinition, CampaignEdge, CampaignNode } from "@kaenma/shared";

export interface CampaignRow {
  id: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  trigger_source: string | null;
  enrollment_count: number;
  active_count: number;
  completed_count: number;
  updated_at: string;
}

export interface AutomationOptions {
  templates: EmailTemplateOption[];
  forms: Array<{ id: string; name: string }>;
  segments: Array<{ id: string; name: string }>;
}

export interface EmailTemplateOption {
  id: string;
  name: string;
  purpose: "transactional" | "marketing";
  subject: string | null;
  sendable: boolean;
}

export interface CampaignDraft {
  graph: CampaignDefinition;
  status: CampaignRow["status"];
}

type PresetId = "welcome" | "cart" | "purchase" | "reengagement";

const presets: Array<{
  id: PresetId;
  name: string;
  description: string;
  icon: typeof UserPlus;
}> = [
  {
    id: "welcome",
    name: "ウェルカムシリーズ",
    description: "連絡先の登録直後と2日後にメールを届けます。",
    icon: UserPlus,
  },
  {
    id: "cart",
    name: "カゴ落ちフォロー",
    description: "cart_abandonedを受け取り、購入がなければ1時間後に送信します。",
    icon: Clock3,
  },
  {
    id: "purchase",
    name: "購入フォローアップ",
    description: "purchase_completedの翌日にサンクスメールを送信します。",
    icon: Sparkles,
  },
  {
    id: "reengagement",
    name: "休眠顧客の再活性化",
    description: "行動が30日間ない顧客へ再訪を促します。",
    icon: Activity,
  },
];

export function CampaignsPage({
  campaigns,
  options,
}: {
  campaigns: CampaignRow[];
  options: AutomationOptions;
}): ReactNode {
  const navigate = useNavigate();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [preset, setPreset] = useState<PresetId>("welcome");
  const [name, setName] = useState("ウェルカムシリーズ");
  const [templateId, setTemplateId] = useState(options.templates[0]?.id ?? "");
  const [creating, setCreating] = useState(false);

  function selectPreset(value: PresetId): void {
    setPreset(value);
    setName(presets.find((item) => item.id === value)?.name ?? "");
  }

  async function createCampaign(): Promise<void> {
    const template = options.templates.find((item) => item.id === templateId);
    if (!template) {
      toast.error("使用するメールテンプレートを選択してください");
      return;
    }
    setCreating(true);
    try {
      const definition = createPresetCampaign(name.trim(), preset, template);
      const response = await rpc<{ id: string }>("/campaigns", {
        method: "POST",
        body: JSON.stringify(definition),
      });
      setCreateOpen(false);
      await navigate({
        to: "/campaigns/$id",
        params: { id: response.data.id },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "オートメーションを作成できません");
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(campaign: CampaignRow): Promise<void> {
    const status = campaign.status === "active" ? "paused" : "active";
    await rpc(`/campaigns/${campaign.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    toast.success(status === "active" ? "オートメーションを再開しました" : "一時停止しました");
    await router.invalidate();
  }

  return (
    <PageLayout
      title="オートメーション"
      action={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          フローを作成
        </Button>
      }
    >
      <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
        顧客の登録、フォーム送信、購入やカゴ落ちなどの行動をきっかけに、
        メール送信・待機・条件分岐を自動で実行します。
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((campaign) => (
          <Card key={campaign.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GitBranch className="size-4" />
              </div>
              <CardTitle>{campaign.name}</CardTitle>
              <CardDescription>{triggerLabel(campaign.trigger_source)}</CardDescription>
              <CardAction>
                <StatusBadge status={campaign.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <Metric label="登録" value={campaign.enrollment_count} />
              <Metric label="進行中" value={campaign.active_count} />
              <Metric label="完了" value={campaign.completed_count} />
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {formatDateTime(campaign.updated_at)}
              </span>
              <div className="flex gap-1">
                {campaign.status === "active" || campaign.status === "paused" ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={campaign.status === "active" ? "一時停止" : "再開"}
                    onClick={() => void changeStatus(campaign)}
                  >
                    {campaign.status === "active" ? <Pause /> : <Play />}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigate({ to: "/campaigns/$id", params: { id: campaign.id } })
                  }
                >
                  編集
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
      {campaigns.length === 0 ? (
        <SimpleEmpty label="テンプレートから最初のオートメーションを作成しましょう" />
      ) : null}
      <AppDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="オートメーションを作成"
        description="目的に近いテンプレートを選び、あとからフローを調整できます。"
        className="sm:max-w-3xl"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {presets.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                preset === item.id
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "hover:bg-muted/60",
              )}
              onClick={() => selectPreset(item.id)}
            >
              <item.icon className="mb-3 size-5 text-primary" />
              <div className="font-medium">{item.name}</div>
              <div className="mt-1 text-sm leading-5 text-muted-foreground">{item.description}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <FormInput
            name="automationName"
            label="フロー名"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <FormNativeSelect
            name="templateId"
            label="送信するメール"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <FormSelectOption value="">選択してください</FormSelectOption>
            {options.templates.map((template) => (
              <FormSelectOption key={template.id} value={template.id}>
                {template.name}
                {template.subject ? ` · ${template.subject}` : ""}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </div>
        {options.templates.length === 0 ? (
          <p className="text-sm text-destructive">
            先に「メール → テンプレート」で送信内容を作成してください。
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCreateOpen(false)}>
            キャンセル
          </Button>
          <Button
            disabled={creating || !name.trim() || !templateId}
            onClick={() => void createCampaign()}
          >
            {creating ? "作成中..." : "このテンプレートで作成"}
          </Button>
        </div>
      </AppDialog>
    </PageLayout>
  );
}

export function CampaignBuilder({
  id,
  initialDraft,
  options,
}: {
  id: string;
  initialDraft: CampaignDraft;
  options: AutomationOptions;
}): ReactNode {
  const [definition, setDefinition] = useState<CampaignDefinition>(initialDraft.graph);
  const [status, setStatus] = useState(initialDraft.status);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialDraft.graph.nodes[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedNode = definition.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const flowNodes: Node[] = useMemo(
    () =>
      definition.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        type: "campaign",
        initialWidth: 180,
        initialHeight: node.type === "decision" || node.type === "condition" ? 82 : 70,
        handles: nodeHandles(node),
        selected: node.id === selectedNodeId,
        data: { node },
      })),
    [definition.nodes, selectedNodeId],
  );
  const flowEdges: Edge[] = useMemo(
    () =>
      definition.edges.map((edge) => {
        const label = branchLabel(edge.branch);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...(edge.branch === "next" ? {} : { sourceHandle: edge.branch }),
          ...(label ? { label } : {}),
          data: { branch: edge.branch },
        };
      }),
    [definition.edges],
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
        edges: changed.map(toCampaignEdge),
      }));
    },
    [flowEdges],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const branch = isBranch(connection.sourceHandle) ? connection.sourceHandle : "next";
      const next = withCampaignConnection(definition, connection.source, connection.target, branch);
      if (!next) {
        toast.error("循環する接続は作成できません");
        return;
      }
      setDefinition(next);
      toast.success("ノードを接続しました");
    },
    [definition],
  );

  function updateNode(nodeId: string, update: (node: CampaignNode) => CampaignNode): void {
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
    }));
  }

  function addNode(kind: "email" | "delay" | "decision" | "condition"): void {
    const id = crypto.randomUUID();
    const position = { x: 360, y: 120 + definition.nodes.length * 70 };
    let node: CampaignNode;
    if (kind === "email") {
      const template = options.templates[0];
      if (!template) {
        toast.error("先にメールテンプレートを作成してください");
        return;
      }
      node = emailNode(id, position, template);
    } else if (kind === "delay") {
      node = {
        id,
        type: "delay",
        position,
        config: { mode: "relative", minutes: 1_440 },
      };
    } else if (kind === "decision") {
      node = {
        id,
        type: "decision",
        position,
        config: { event: "opened", withinMinutes: 1_440 },
      };
    } else {
      node = {
        id,
        type: "condition",
        position,
        config: { field: "stage", operator: "eq", value: "customer" },
      };
    }
    const freeBranch = selectedNode
      ? connectionBranches(selectedNode).find(
          ([branch]) =>
            !definition.edges.some(
              (edge) => edge.source === selectedNode.id && edge.branch === branch,
            ),
        )?.[0]
      : undefined;
    setDefinition({
      ...definition,
      nodes: [...definition.nodes, node],
      edges:
        selectedNode && freeBranch
          ? [
              ...definition.edges,
              {
                id: crypto.randomUUID(),
                source: selectedNode.id,
                target: node.id,
                branch: freeBranch,
              },
            ]
          : definition.edges,
    });
    setSelectedNodeId(id);
    toast.success(freeBranch ? "ステップを追加して接続しました" : "ステップを追加しました");
  }

  function setConnection(sourceId: string, branch: CampaignEdge["branch"], targetId: string): void {
    const next = withCampaignConnection(definition, sourceId, targetId || null, branch);
    if (!next) {
      toast.error("循環する接続は作成できません");
      return;
    }
    setDefinition(next);
    toast.success(targetId ? "接続先を更新しました" : "接続を解除しました");
  }

  function deleteSelectedNode(): void {
    if (!selectedNode || selectedNode.type === "source") return;
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selectedNode.id),
      edges: current.edges.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    }));
    setSelectedNodeId(null);
  }

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
        setStatus("active");
        setNotice("公開しました。以降の行動イベントから自動登録されます。");
        toast.success("オートメーションを公開しました");
      } else {
        setNotice("下書きを保存しました");
        toast.success("下書きを保存しました");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存できませんでした";
      setNotice(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(): Promise<void> {
    const nextStatus = status === "active" ? "paused" : "active";
    await rpc(`/campaigns/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: nextStatus }),
    });
    setStatus(nextStatus);
    toast.success(nextStatus === "active" ? "再開しました" : "一時停止しました");
  }

  return (
    <div className="-m-4 lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-4 lg:px-8">
        <div className="min-w-64">
          <Input
            aria-label="オートメーション名"
            className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
            value={definition.name}
            onChange={(event) =>
              setDefinition((current) => ({ ...current, name: event.target.value }))
            }
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={status} />
            <span>{definition.timezone}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice ? <span className="max-w-72 text-sm text-muted-foreground">{notice}</span> : null}
          {status === "active" || status === "paused" ? (
            <Button variant="outline" disabled={saving} onClick={() => void changeStatus()}>
              {status === "active" ? (
                <Pause data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {status === "active" ? "一時停止" : "再開"}
            </Button>
          ) : null}
          <Button variant="outline" disabled={saving} onClick={() => void save()}>
            <Save data-icon="inline-start" />
            保存
          </Button>
          <Button disabled={saving} onClick={() => void save(true)}>
            <Send data-icon="inline-start" />
            公開
          </Button>
        </div>
      </div>
      <div className="grid h-[calc(100vh-8.5rem)] min-h-[600px] grid-cols-[64px_minmax(0,1fr)] bg-muted/60 lg:grid-cols-[180px_minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-2 border-r bg-background p-2 lg:p-3">
          <div className="hidden px-1 pb-1 text-xs font-medium text-muted-foreground lg:block">
            ステップを追加
          </div>
          <StepButton icon={Mail} label="メール" onClick={() => addNode("email")} />
          <StepButton icon={Clock3} label="待機" onClick={() => addNode("delay")} />
          <StepButton
            icon={MousePointerClick}
            label="行動を待つ"
            onClick={() => addNode("decision")}
          />
          <StepButton icon={GitBranch} label="条件分岐" onClick={() => addNode("condition")} />
        </div>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={campaignNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          deleteKeyCode={null}
        >
          <Background color="#cbd5e1" gap={24} />
          <Panel position="top-center">
            <Badge variant="secondary" className="shadow-sm">
              右端の丸から、次のノードの左端の丸へドラッグして接続
            </Badge>
          </Panel>
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
        <div className="hidden overflow-y-auto border-l bg-background lg:block">
          <NodeSettings
            node={selectedNode}
            nodes={definition.nodes}
            edges={definition.edges}
            options={options}
            onUpdate={(update) => {
              if (selectedNode) updateNode(selectedNode.id, update);
            }}
            onConnectionChange={setConnection}
            onDelete={deleteSelectedNode}
          />
        </div>
      </div>
    </div>
  );
}

function NodeSettings({
  node,
  nodes,
  edges,
  options,
  onUpdate,
  onConnectionChange,
  onDelete,
}: {
  node: CampaignNode | null;
  nodes: CampaignNode[];
  edges: CampaignEdge[];
  options: AutomationOptions;
  onUpdate: (update: (node: CampaignNode) => CampaignNode) => void;
  onConnectionChange: (sourceId: string, branch: CampaignEdge["branch"], targetId: string) => void;
  onDelete: () => void;
}): ReactNode {
  if (!node) {
    return (
      <div className="p-6 text-sm leading-6 text-muted-foreground">
        キャンバス上のステップを選択すると、ここで開始条件や実行内容を設定できます。
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {nodeTypeLabel(node.type)}
          </div>
          <h2 className="mt-1 font-medium">{nodeLabel(node)}</h2>
        </div>
        {node.type !== "source" ? (
          <Button size="icon-sm" variant="ghost" aria-label="ステップを削除" onClick={onDelete}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      {node.type === "source" ? (
        <SourceSettings node={node} options={options} onUpdate={onUpdate} />
      ) : null}
      {node.type === "action" ? (
        <ActionSettings node={node} options={options} onUpdate={onUpdate} />
      ) : null}
      {node.type === "delay" ? <DelaySettings node={node} onUpdate={onUpdate} /> : null}
      {node.type === "decision" ? <DecisionSettings node={node} onUpdate={onUpdate} /> : null}
      {node.type === "condition" ? <ConditionSettings node={node} onUpdate={onUpdate} /> : null}
      <ConnectionSettings
        node={node}
        nodes={nodes}
        edges={edges}
        onConnectionChange={onConnectionChange}
      />
    </div>
  );
}

function ConnectionSettings({
  node,
  nodes,
  edges,
  onConnectionChange,
}: {
  node: CampaignNode;
  nodes: CampaignNode[];
  edges: CampaignEdge[];
  onConnectionChange: (sourceId: string, branch: CampaignEdge["branch"], targetId: string) => void;
}): ReactNode {
  const targets = nodes.filter((target) => target.id !== node.id && target.type !== "source");
  const branches = connectionBranches(node);
  return (
    <>
      <FieldSeparator>接続</FieldSeparator>
      <FieldDescription>
        キャンバス上で丸をドラッグするか、ここで次に実行するステップを選択できます。
      </FieldDescription>
      {branches.map(([branch, label]) => (
        <SettingSelect
          key={branch}
          label={branches.length === 1 ? "接続先" : `${label}の接続先`}
          value={
            edges.find((edge) => edge.source === node.id && edge.branch === branch)?.target ?? ""
          }
          onChange={(targetId) => onConnectionChange(node.id, branch, targetId)}
          options={[
            ["", "未接続"],
            ...targets.map(
              (target) =>
                [
                  target.id,
                  `${nodes.findIndex((candidate) => candidate.id === target.id) + 1}. ${nodeLabel(target)}`,
                ] as const,
            ),
          ]}
        />
      ))}
    </>
  );
}

function SourceSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<CampaignNode, { type: "source" }>;
  options: AutomationOptions;
  onUpdate: (update: (node: CampaignNode) => CampaignNode) => void;
}): ReactNode {
  const source = node.config.source;
  return (
    <>
      <SettingSelect
        label="開始条件"
        value={source}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "source"
              ? {
                  ...current,
                  config: sourceConfig(
                    value,
                    options.forms[0]?.id ?? "",
                    options.segments[0]?.id ?? "",
                  ),
                }
              : current,
          )
        }
        options={[
          ["contact_created", "連絡先が登録された"],
          ["form_submitted", "フォームが送信された"],
          ["segment_joined", "セグメントに参加した"],
          ["api_event", "APIイベントを受け取った"],
          ["webhook_event", "Webhookイベントを受け取った"],
          ["contact_inactive", "一定期間行動がない"],
        ]}
      />
      {source === "form_submitted" ? (
        <SettingSelect
          label="フォーム"
          value={node.config.formId}
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source"
                ? { ...current, config: { ...node.config, formId: value } }
                : current,
            )
          }
          options={options.forms.map((form) => [form.id, form.name])}
        />
      ) : null}
      {source === "segment_joined" ? (
        <SettingSelect
          label="セグメント"
          value={node.config.segmentId}
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source"
                ? { ...current, config: { ...node.config, segmentId: value } }
                : current,
            )
          }
          options={options.segments.map((segment) => [segment.id, segment.name])}
        />
      ) : null}
      {source === "api_event" || source === "webhook_event" ? (
        <SettingInput
          label="イベント名"
          value={node.config.eventName}
          placeholder="cart_abandoned"
          description="連絡先イベントAPIまたはサイトトラッキングから送る名前です。"
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source" &&
              (current.config.source === "api_event" || current.config.source === "webhook_event")
                ? { ...current, config: { ...current.config, eventName: value } }
                : current,
            )
          }
        />
      ) : null}
      {source === "contact_inactive" ? (
        <SettingInput
          label="行動がない日数"
          type="number"
          min={1}
          max={3650}
          value={String(node.config.days)}
          onChange={(value) =>
            onUpdate((current) =>
              current.type === "source" && current.config.source === "contact_inactive"
                ? {
                    ...current,
                    config: { ...current.config, days: Math.max(1, Number(value) || 1) },
                  }
                : current,
            )
          }
        />
      ) : null}
      {"reentry" in node.config &&
      node.config.source !== "contact_created" &&
      node.config.source !== "contact_inactive" ? (
        <SettingSelect
          label="再登録"
          value={node.config.reentry}
          onChange={(value) =>
            onUpdate((current) => {
              if (
                current.type !== "source" ||
                current.config.source === "contact_created" ||
                current.config.source === "contact_inactive"
              )
                return current;
              return {
                ...current,
                config: {
                  ...current.config,
                  reentry: value === "every_time" ? "every_time" : "once",
                },
              };
            })
          }
          options={[
            ["once", "連絡先ごとに1回"],
            ["every_time", "イベントのたびに登録"],
          ]}
        />
      ) : null}
    </>
  );
}

function ActionSettings({
  node,
  options,
  onUpdate,
}: {
  node: Extract<CampaignNode, { type: "action" }>;
  options: AutomationOptions;
  onUpdate: (update: (node: CampaignNode) => CampaignNode) => void;
}): ReactNode {
  if (node.config.action === "send_email") {
    return (
      <SettingSelect
        label="メールテンプレート"
        value={node.config.templateId}
        onChange={(value) => {
          const template = options.templates.find((item) => item.id === value);
          if (!template) return;
          onUpdate((current) =>
            current.type === "action" && current.config.action === "send_email"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    templateId: value,
                  },
                }
              : current,
          );
        }}
        options={options.templates.map((template) => [template.id, template.name])}
      />
    );
  }
  if (node.config.action === "change_score") {
    return (
      <SettingInput
        label="スコア変更量"
        type="number"
        value={String(node.config.amount)}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "action" && current.config.action === "change_score"
              ? { ...current, config: { ...current.config, amount: Number(value) || 0 } }
              : current,
          )
        }
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground">このアクションはJSON定義で設定されています。</p>
  );
}

function DelaySettings({
  node,
  onUpdate,
}: {
  node: Extract<CampaignNode, { type: "delay" }>;
  onUpdate: (update: (node: CampaignNode) => CampaignNode) => void;
}): ReactNode {
  if (node.config.mode !== "relative") {
    return (
      <p className="text-sm text-muted-foreground">相対待機へ変更すると画面で編集できます。</p>
    );
  }
  return (
    <SettingInput
      label="待機時間（分）"
      type="number"
      min={1}
      max={525600}
      value={String(node.config.minutes)}
      description={`${formatDuration(node.config.minutes)} 待ってから次へ進みます。`}
      onChange={(value) =>
        onUpdate((current) =>
          current.type === "delay" && current.config.mode === "relative"
            ? {
                ...current,
                config: { ...current.config, minutes: Math.max(1, Number(value) || 1) },
              }
            : current,
        )
      }
    />
  );
}

function DecisionSettings({
  node,
  onUpdate,
}: {
  node: Extract<CampaignNode, { type: "decision" }>;
  onUpdate: (update: (node: CampaignNode) => CampaignNode) => void;
}): ReactNode {
  return (
    <>
      <SettingSelect
        label="待つ行動"
        value={node.config.event}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "decision"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    event: value as typeof current.config.event,
                  },
                }
              : current,
          )
        }
        options={[
          ["opened", "メール開封"],
          ["clicked", "メールクリック"],
          ["replied", "メール返信"],
          ["page_viewed", "ページ閲覧"],
          ["form_submitted", "フォーム送信"],
          ["custom_event", "カスタムイベント"],
        ]}
      />
      <SettingInput
        label={node.config.event === "custom_event" ? "イベント名" : "対象ID（任意）"}
        value={node.config.resourceId ?? ""}
        placeholder={node.config.event === "custom_event" ? "purchase_completed" : "未指定"}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "decision"
              ? {
                  ...current,
                  config: { ...current.config, resourceId: value || undefined },
                }
              : current,
          )
        }
      />
      <SettingInput
        label="待機上限（分）"
        type="number"
        min={1}
        max={525600}
        value={String(node.config.withinMinutes)}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "decision"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    withinMinutes: Math.max(1, Number(value) || 1),
                  },
                }
              : current,
          )
        }
      />
      <p className="text-xs leading-5 text-muted-foreground">
        行動ありは「はい」、上限到達は「時間切れ」の接続先へ進みます。
      </p>
    </>
  );
}

function ConditionSettings({
  node,
  onUpdate,
}: {
  node: Extract<CampaignNode, { type: "condition" }>;
  onUpdate: (update: (node: CampaignNode) => CampaignNode) => void;
}): ReactNode {
  return (
    <>
      <SettingInput
        label="連絡先フィールド"
        value={node.config.field}
        placeholder="stage"
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "condition"
              ? { ...current, config: { ...current.config, field: value } }
              : current,
          )
        }
      />
      <SettingSelect
        label="比較"
        value={node.config.operator}
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "condition"
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    operator: value as typeof current.config.operator,
                  },
                }
              : current,
          )
        }
        options={[
          ["eq", "等しい"],
          ["neq", "等しくない"],
          ["contains", "含む"],
          ["gt", "より大きい"],
          ["gte", "以上"],
          ["lt", "より小さい"],
          ["lte", "以下"],
          ["exists", "値がある"],
          ["not_exists", "値がない"],
        ]}
      />
      <SettingInput
        label="比較する値"
        value={
          typeof node.config.value === "string"
            ? node.config.value
            : String(node.config.value ?? "")
        }
        onChange={(value) =>
          onUpdate((current) =>
            current.type === "condition"
              ? { ...current, config: { ...current.config, value } }
              : current,
          )
        }
      />
      <p className="text-xs leading-5 text-muted-foreground">
        条件一致は「はい」、不一致は「いいえ」の接続先へ進みます。
      </p>
    </>
  );
}

function CampaignFlowNode({ data, selected }: NodeProps<Node<{ node: CampaignNode }>>): ReactNode {
  const node = data.node;
  const colors: Record<CampaignNode["type"], string> = {
    source: "border-emerald-500",
    action: "border-primary",
    condition: "border-amber-500",
    decision: "border-violet-500",
    delay: "border-slate-400",
  };
  return (
    <Card
      size="sm"
      className={cn(
        "min-w-44 border-2 py-3 shadow-md transition-shadow",
        colors[node.type],
        selected && "ring-4 ring-primary/20",
      )}
    >
      {node.type !== "source" ? (
        <Handle
          type="target"
          position={Position.Left}
          title="ここへ接続"
          className="size-4! border-[3px]! border-background! bg-muted-foreground! shadow-sm"
        />
      ) : null}
      <CardHeader>
        <CardDescription className="text-[10px] font-semibold tracking-widest uppercase">
          {nodeTypeLabel(node.type)}
        </CardDescription>
        <CardTitle>{nodeLabel(node)}</CardTitle>
      </CardHeader>
      {node.type === "condition" ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            title="「はい」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "35%" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Right}
            title="「いいえ」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "72%" }}
          />
        </>
      ) : node.type === "decision" ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            title="「はい」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "28%" }}
          />
          <Handle
            id="timeout"
            type="source"
            position={Position.Right}
            title="「時間切れ」の接続"
            className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
            style={{ top: "72%" }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          title="ここから接続"
          className="size-4! border-[3px]! border-background! bg-primary! shadow-sm"
        />
      )}
    </Card>
  );
}

const campaignNodeTypes = { campaign: CampaignFlowNode };

function StepButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Mail;
  label: string;
  onClick: () => void;
}): ReactNode {
  return (
    <Button
      variant="ghost"
      className="h-auto flex-col gap-1 px-1 py-2 text-[10px] lg:flex-row lg:justify-start lg:gap-2 lg:px-2 lg:text-sm"
      onClick={onClick}
    >
      <Icon />
      <span>{label}</span>
    </Button>
  );
}

function SettingInput({
  label,
  description,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  label: string;
  description?: string;
  onChange: (value: string) => void;
}): ReactNode {
  const id = `setting-${label}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} onChange={(event) => onChange(event.target.value)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

function SettingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<readonly [string, string]>;
}): ReactNode {
  const id = `setting-${label}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        className="w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length === 0 ? (
          <NativeSelectOption value="">選択肢がありません</NativeSelectOption>
        ) : null}
        {options.map(([optionValue, optionLabel]) => (
          <NativeSelectOption key={optionValue} value={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

function StatusBadge({ status }: { status: CampaignRow["status"] }): ReactNode {
  const label = {
    draft: "下書き",
    active: "稼働中",
    paused: "一時停止",
    archived: "アーカイブ",
  }[status];
  return (
    <Badge variant={status === "active" ? "default" : "secondary"}>
      {status === "active" ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {label}
    </Badge>
  );
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function createPresetCampaign(
  name: string,
  preset: PresetId,
  template: EmailTemplateOption,
): CampaignDefinition {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (preset === "welcome") {
    return {
      name,
      description: "新しく登録された連絡先向けのウェルカムシリーズ",
      timezone,
      nodes: [
        sourceNode({ source: "contact_created", reentry: "once" }, 80, 180),
        emailNode("welcome-1", { x: 350, y: 180 }, template),
        delayNode("welcome-wait", 2_880, 620, 180),
        emailNode("welcome-2", { x: 890, y: 180 }, template),
      ],
      edges: chainEdges(["source", "welcome-1", "welcome-wait", "welcome-2"]),
    };
  }
  if (preset === "cart") {
    return {
      name,
      description: "カゴ落ち後、購入完了がない連絡先へのフォロー",
      timezone,
      nodes: [
        sourceNode(
          { source: "api_event", eventName: "cart_abandoned", reentry: "every_time" },
          60,
          180,
        ),
        delayNode("cart-wait", 60, 320, 180),
        {
          id: "purchase-check",
          type: "decision",
          position: { x: 580, y: 180 },
          config: {
            event: "custom_event",
            resourceId: "purchase_completed",
            withinMinutes: 1,
          },
        },
        emailNode("cart-email", { x: 850, y: 300 }, template),
      ],
      edges: [
        { id: "source-cart-wait", source: "source", target: "cart-wait", branch: "next" },
        {
          id: "cart-wait-check",
          source: "cart-wait",
          target: "purchase-check",
          branch: "next",
        },
        {
          id: "cart-timeout-email",
          source: "purchase-check",
          target: "cart-email",
          branch: "timeout",
        },
      ],
    };
  }
  if (preset === "purchase") {
    return {
      name,
      description: "購入後のサンクス・フォローアップ",
      timezone,
      nodes: [
        sourceNode(
          { source: "api_event", eventName: "purchase_completed", reentry: "every_time" },
          80,
          180,
        ),
        delayNode("purchase-wait", 1_440, 360, 180),
        emailNode("purchase-email", { x: 650, y: 180 }, template),
      ],
      edges: chainEdges(["source", "purchase-wait", "purchase-email"]),
    };
  }
  return {
    name,
    description: "30日間行動がない連絡先向けの再エンゲージメント",
    timezone,
    nodes: [
      sourceNode({ source: "contact_inactive", days: 30, reentry: "once" }, 80, 180),
      emailNode("reengagement-email", { x: 380, y: 180 }, template),
    ],
    edges: chainEdges(["source", "reengagement-email"]),
  };
}

function sourceNode(
  config: Extract<CampaignNode, { type: "source" }>["config"],
  x: number,
  y: number,
): Extract<CampaignNode, { type: "source" }> {
  return { id: "source", type: "source", position: { x, y }, config };
}

function emailNode(
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

function delayNode(
  id: string,
  minutes: number,
  x: number,
  y: number,
): Extract<CampaignNode, { type: "delay" }> {
  return { id, type: "delay", position: { x, y }, config: { mode: "relative", minutes } };
}

function chainEdges(ids: string[]): CampaignEdge[] {
  return ids.slice(1).map((target, index) => ({
    id: `${ids[index]}-${target}`,
    source: ids[index]!,
    target,
    branch: "next",
  }));
}

function sourceConfig(
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

function nodeHandles(node: CampaignNode): NonNullable<Node["handles"]> {
  const height = node.type === "decision" || node.type === "condition" ? 82 : 70;
  const target =
    node.type === "source"
      ? []
      : [
          {
            id: null,
            type: "target" as const,
            position: Position.Left,
            x: -8,
            y: height / 2 - 8,
            width: 16,
            height: 16,
          },
        ];
  if (node.type === "condition") {
    return [
      ...target,
      {
        id: "yes",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.35 - 8,
        width: 16,
        height: 16,
      },
      {
        id: "no",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.72 - 8,
        width: 16,
        height: 16,
      },
    ];
  }
  if (node.type === "decision") {
    return [
      ...target,
      {
        id: "yes",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.28 - 8,
        width: 16,
        height: 16,
      },
      {
        id: "timeout",
        type: "source",
        position: Position.Right,
        x: 172,
        y: height * 0.72 - 8,
        width: 16,
        height: 16,
      },
    ];
  }
  return [
    ...target,
    {
      id: null,
      type: "source",
      position: Position.Right,
      x: 172,
      y: height / 2 - 8,
      width: 16,
      height: 16,
    },
  ];
}

function nodeLabel(node: CampaignNode): string {
  if (node.type === "source") return triggerLabel(node.config.source);
  if (node.type === "delay") {
    return node.config.mode === "relative"
      ? formatDuration(node.config.minutes)
      : "指定日時まで待機";
  }
  if (node.type === "decision") return `${eventLabel(node.config.event)}を待つ`;
  if (node.type === "condition") return `${node.config.field} を判定`;
  if (node.config.action === "send_email") return "メールを送信";
  if (node.config.action === "change_score")
    return `スコア ${node.config.amount >= 0 ? "+" : ""}${node.config.amount}`;
  return node.config.action.replaceAll("_", " ");
}

function nodeTypeLabel(type: CampaignNode["type"]): string {
  return {
    source: "開始条件",
    action: "アクション",
    condition: "条件分岐",
    decision: "行動待機",
    delay: "待機",
  }[type];
}

function triggerLabel(source: string | null): string {
  if (!source) return "未公開";
  return (
    {
      contact_created: "連絡先が登録されたとき",
      form_submitted: "フォームが送信されたとき",
      segment_joined: "セグメントに参加したとき",
      api_event: "APIイベントを受け取ったとき",
      webhook_event: "Webhookイベントを受け取ったとき",
      contact_inactive: "一定期間行動がないとき",
    }[source] ?? source
  );
}

function eventLabel(event: Extract<CampaignNode, { type: "decision" }>["config"]["event"]): string {
  return {
    opened: "メール開封",
    clicked: "メールクリック",
    replied: "メール返信",
    page_viewed: "ページ閲覧",
    form_submitted: "フォーム送信",
    custom_event: "カスタムイベント",
  }[event];
}

function formatDuration(minutes: number): string {
  if (minutes % 1_440 === 0) return `${minutes / 1_440}日`;
  if (minutes % 60 === 0) return `${minutes / 60}時間`;
  return `${minutes}分`;
}

function branchLabel(branch: CampaignEdge["branch"]): string | undefined {
  return { next: undefined, yes: "はい", no: "いいえ", timeout: "時間切れ" }[branch];
}

function connectionBranches(node: CampaignNode): Array<readonly [CampaignEdge["branch"], string]> {
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

function withCampaignConnection(
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

function connectionCreatesCycle(
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

function isBranch(value: string | null | undefined): value is CampaignEdge["branch"] {
  return value === "next" || value === "yes" || value === "no" || value === "timeout";
}

function toCampaignEdge(edge: Edge): CampaignEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    branch: isBranch(edge.data?.["branch"] as string | undefined)
      ? (edge.data?.["branch"] as CampaignEdge["branch"])
      : "next",
  };
}

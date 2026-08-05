import {
  type AutomationDefinition,
  type AutomationEdge,
  type AutomationNode,
  type AutomationRow,
} from "@openengage/orpc";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  Panel,
  ReactFlow,
} from "@xyflow/react";
import {
  Clock3,
  GitBranch,
  Mail,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Save,
  Send,
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
import { Input } from "@/components/ui/input";
import {
  automationsQueryOptions,
  emailTemplateOptionsQueryOptions,
} from "@/features/automations/automation-api";
import { formatDateTime } from "@/lib/format";
import { orpcQuery } from "@/lib/orpc";
import { cn } from "@/lib/utils";

import { automationNodeTypes, nodeHandles, StepButton } from "./automation-flow-node";
import {
  connectionBranches,
  isBranch,
  toAutomationEdge,
  withAutomationConnection,
} from "./automation-graph";
import { emailNode } from "./automation-graph";
import { branchLabel, triggerLabel } from "./automation-labels";
import { NodeSettings } from "./automation-node-settings";
import { createPresetAutomation, type PresetId, presets } from "./automation-presets";
import { type AutomationDraft, type AutomationOptions } from "./automation-types";

export type {
  AutomationOptions,
  AutomationDraft,
  AutomationRow,
  EmailTemplateOption,
} from "./automation-types";

export function AutomationsPage(): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: automations } = useSuspenseQuery(automationsQueryOptions());
  const { data: allTemplates } = useSuspenseQuery(emailTemplateOptionsQueryOptions());
  const templates = useMemo(
    () => allTemplates.filter((template) => template.sendable),
    [allTemplates],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [preset, setPreset] = useState<PresetId>("welcome");
  const [name, setName] = useState("ウェルカムシリーズ");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [creating, setCreating] = useState(false);

  const createAutomation = useMutation(orpcQuery.automations.create.mutationOptions());
  const setAutomationStatus = useMutation(orpcQuery.automations.setStatus.mutationOptions());

  function selectPreset(value: PresetId): void {
    setPreset(value);
    setName(presets.find((item) => item.id === value)?.name ?? "");
  }

  async function createAutomationFlow(): Promise<void> {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      toast.error("使用するメールテンプレートを選択してください");
      return;
    }
    setCreating(true);
    try {
      const definition = createPresetAutomation(name.trim(), preset, template);
      const created = await createAutomation.mutateAsync(definition);
      await queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() });
      setCreateOpen(false);
      await navigate({
        to: "/automations/$id",
        params: { id: created.id },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "オートメーションを作成できません");
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(automation: AutomationRow): Promise<void> {
    const status = automation.status === "active" ? "paused" : "active";
    try {
      await setAutomationStatus.mutateAsync({ id: automation.id, status });
      await queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() });
      toast.success(status === "active" ? "オートメーションを再開しました" : "一時停止しました");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新できませんでした");
    }
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
        {automations.map((automation) => (
          <Card key={automation.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GitBranch className="size-4" />
              </div>
              <CardTitle>{automation.name}</CardTitle>
              <CardDescription>{triggerLabel(automation.triggerSource)}</CardDescription>
              <CardAction>
                <AutomationStatusBadge status={automation.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <Metric label="登録" value={automation.enrollmentCount} />
              <Metric label="進行中" value={automation.activeCount} />
              <Metric label="完了" value={automation.completedCount} />
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {formatDateTime(automation.updatedAt)}
              </span>
              <div className="flex gap-1">
                {automation.status === "active" || automation.status === "paused" ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={automation.status === "active" ? "一時停止" : "再開"}
                    onClick={() => void changeStatus(automation)}
                  >
                    {automation.status === "active" ? <Pause /> : <Play />}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigate({ to: "/automations/$id", params: { id: automation.id } })
                  }
                >
                  編集
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
      {automations.length === 0 ? (
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
            {templates.map((template) => (
              <FormSelectOption key={template.id} value={template.id}>
                {template.name}
                {template.subject ? ` · ${template.subject}` : ""}
              </FormSelectOption>
            ))}
          </FormNativeSelect>
        </div>
        {templates.length === 0 ? (
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
            onClick={() => void createAutomationFlow()}
          >
            {creating ? "作成中..." : "このテンプレートで作成"}
          </Button>
        </div>
      </AppDialog>
    </PageLayout>
  );
}

export function AutomationBuilder({
  id,
  initialDraft,
  options,
}: {
  id: string;
  initialDraft: AutomationDraft;
  options: AutomationOptions;
}): ReactNode {
  const queryClient = useQueryClient();
  const saveDraft = useMutation(orpcQuery.automations.saveDraft.mutationOptions());
  const publishDraft = useMutation(orpcQuery.automations.publish.mutationOptions());
  const setAutomationStatus = useMutation(orpcQuery.automations.setStatus.mutationOptions());
  const [definition, setDefinition] = useState<AutomationDefinition>(initialDraft.graph);
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
        type: "automation",
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
        edges: changed.map(toAutomationEdge),
      }));
    },
    [flowEdges],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const branch = isBranch(connection.sourceHandle) ? connection.sourceHandle : "next";
      const next = withAutomationConnection(
        definition,
        connection.source,
        connection.target,
        branch,
      );
      if (!next) {
        toast.error("循環する接続は作成できません");
        return;
      }
      setDefinition(next);
      toast.success("ノードを接続しました");
    },
    [definition],
  );

  function updateNode(nodeId: string, update: (node: AutomationNode) => AutomationNode): void {
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
    }));
  }

  function addNode(kind: "email" | "delay" | "decision" | "condition"): void {
    const id = crypto.randomUUID();
    const position = { x: 360, y: 120 + definition.nodes.length * 70 };
    let node: AutomationNode;
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

  function setConnection(
    sourceId: string,
    branch: AutomationEdge["branch"],
    targetId: string,
  ): void {
    const next = withAutomationConnection(definition, sourceId, targetId || null, branch);
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
      await saveDraft.mutateAsync({ id, ...definition });
      if (publish) {
        await publishDraft.mutateAsync({ id });
        setStatus("active");
        setNotice("公開しました。以降の行動イベントから自動登録されます。");
        toast.success("オートメーションを公開しました");
      } else {
        setNotice("下書きを保存しました");
        toast.success("下書きを保存しました");
      }
      // The list page's cache would otherwise still show the pre-save status/
      // enrollment counts when the user navigates back to it.
      await queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() });
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
    try {
      await setAutomationStatus.mutateAsync({ id, status: nextStatus });
      setStatus(nextStatus);
      await queryClient.invalidateQueries({ queryKey: orpcQuery.automations.list.key() });
      toast.success(nextStatus === "active" ? "再開しました" : "一時停止しました");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新できませんでした");
    }
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
            <AutomationStatusBadge status={status} />
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
          nodeTypes={automationNodeTypes}
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

function AutomationStatusBadge({ status }: { status: AutomationRow["status"] }): ReactNode {
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

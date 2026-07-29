import type {
  CampaignDefinition,
  CampaignEdge,
  CampaignNode,
  SegmentFilter,
} from "@kaenma/shared";
import { contactAttributeDefinitions } from "@kaenma/shared";
import {
  AppDialog,
  ErrorAlert as ErrorMessage,
  FormInput as Field,
  FormNativeSelect,
  FormSelectOption,
  LoadingButton,
  PageLayout as Page,
  PageLoading,
  ResourceCard,
  ResourceGrid,
  SimpleEmpty as Empty,
  SuccessAlert as SuccessMessage,
} from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Link, Outlet, linkOptions, useNavigate } from "@tanstack/react-router";
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
import {
  Activity,
  Archive,
  Blocks,
  Braces,
  Building2,
  ContactRound,
  FileText,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  LogOut,
  Mail,
  Plus,
  Save,
  Send,
  Settings,
  Shapes,
  Tags,
  UsersRound,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, ApiClientError } from "./api";
import { authClient } from "./auth-client";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: string;
}

const WorkspaceContext = createContext<Workspace | null>(null);

interface DashboardData {
  contacts: { count: number };
  campaigns: { count: number };
  deliveries: { sent: number; delivered: number; failed: number };
  recentEvents: Array<{ type: string; occurred_at: string }>;
}

export function App(): ReactNode {
  const session = authClient.useSession();
  if (session.isPending)
    return <FullScreenStatus label="セッションを確認しています…" />;
  if (!session.data) return <AuthScreen />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp(): ReactNode {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsWorkspace, setNeedsWorkspace] = useState(false);

  useEffect(() => {
    void api<Workspace>("/workspace")
      .then((response) => setWorkspace(response.data))
      .catch((error: unknown) => {
        if (
          error instanceof ApiClientError &&
          error.code === "workspace_required"
        ) {
          setNeedsWorkspace(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return <FullScreenStatus label="ワークスペースを読み込んでいます…" />;
  if (needsWorkspace || !workspace) {
    return (
      <WorkspaceSetup
        onCreated={() => {
          window.location.reload();
        }}
      />
    );
  }
  return <Shell workspace={workspace} />;
}

function Shell({ workspace }: { workspace: Workspace }): ReactNode {
  const navigationBeforeContacts = linkOptions([
    { to: "/dashboard", label: "ダッシュボード", icon: Gauge },
  ]);
  const contactNavigation = linkOptions([
    { to: "/contacts", label: "連絡先", icon: UsersRound },
    { to: "/contacts/accounts", label: "アカウント", icon: Building2 },
    { to: "/contacts/lists", label: "リスト", icon: ListChecks },
    { to: "/contacts/tags", label: "タグ", icon: Tags },
    { to: "/contacts/segments", label: "セグメント", icon: Shapes },
  ]);
  const navigationBeforeEmail = linkOptions([
    { to: "/campaigns", label: "キャンペーン", icon: GitBranch },
  ]);
  const emailNavigation = linkOptions([
    { to: "/emails", label: "キャンペーン", icon: Send },
    { to: "/emails/templates", label: "テンプレート", icon: FileText },
    { to: "/emails/variables", label: "メッセージ変数", icon: Braces },
    { to: "/emails/archive", label: "アーカイブ", icon: Archive },
  ]);
  const navigationAfterEmail = linkOptions([
    { to: "/forms", label: "フォーム", icon: FileText },
    { to: "/settings", label: "設定", icon: Settings },
  ]);
  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-none focus:ring-3 focus:ring-ring/50"
      >
        メインコンテンツへ移動
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Kaenma">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Blocks />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Kaenma</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {workspace.name}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>ワークスペース</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigationBeforeContacts.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={
                        <Link
                          to={item.to}
                          activeProps={{ "data-active": "true" }}
                        />
                      }
                      tooltip={item.label}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <Link
                        to="/contacts"
                        activeProps={{ "data-active": "true" }}
                      />
                    }
                    tooltip="コンタクト"
                  >
                    <ContactRound />
                    <span>コンタクト</span>
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    {contactNavigation.map((item) => (
                      <SidebarMenuSubItem key={item.to}>
                        <SidebarMenuSubButton
                          render={
                            <Link
                              to={item.to}
                              activeOptions={{ exact: true }}
                              activeProps={{ "data-active": "true" }}
                            />
                          }
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </SidebarMenuItem>
                {navigationBeforeEmail.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={
                        <Link
                          to={item.to}
                          activeProps={{ "data-active": "true" }}
                        />
                      }
                      tooltip={item.label}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <Link
                        to="/emails"
                        activeProps={{ "data-active": "true" }}
                      />
                    }
                    tooltip="メール"
                  >
                    <Mail />
                    <span>メール</span>
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    {emailNavigation.map((item) => (
                      <SidebarMenuSubItem key={item.to}>
                        <SidebarMenuSubButton
                          render={
                            <Link
                              to={item.to}
                              activeOptions={{ exact: true }}
                              activeProps={{ "data-active": "true" }}
                            />
                          }
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </SidebarMenuItem>
                {navigationAfterEmail.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={
                        <Link
                          to={item.to}
                          activeProps={{ "data-active": "true" }}
                        />
                      }
                      tooltip={item.label}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex flex-col gap-2 rounded-lg border p-2 text-xs group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Cloudflare native</span>
              <Badge variant="secondary">
                <span className="size-1.5 rounded-full bg-success" />
                Online
              </Badge>
            </div>
            <span className="text-muted-foreground">
              Role: {workspace.role}
            </span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset id="main-content" tabIndex={-1}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger aria-label="ナビゲーションを開閉" />
            <Separator orientation="vertical" className="h-4" />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {workspace.name} / {workspace.timezone}
            </span>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void authClient.signOut().then(() => window.location.reload());
            }}
          >
            <LogOut data-icon="inline-start" />
            ログアウト
          </Button>
        </header>
        <div className="mx-auto w-full max-w-[1500px] p-4 lg:p-8">
          <WorkspaceContext.Provider value={workspace}>
            <Outlet />
          </WorkspaceContext.Provider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function Dashboard(): ReactNode {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => {
    void api<DashboardData>("/dashboard").then((response) =>
      setData(response.data),
    );
  }, []);
  if (!data) return <PageLoading />;
  const deliveredRate =
    data.deliveries.sent > 0
      ? Math.round((data.deliveries.delivered / data.deliveries.sent) * 1000) /
        10
      : 0;
  const cards = [
    {
      label: "アクティブ連絡先",
      value: data.contacts.count.toLocaleString(),
      icon: UsersRound,
    },
    {
      label: "公開キャンペーン",
      value: data.campaigns.count.toLocaleString(),
      icon: Activity,
    },
    {
      label: "30日間の配信",
      value: data.deliveries.sent.toLocaleString(),
      icon: Send,
    },
    { label: "配信到達率", value: `${deliveredRate}%`, icon: Gauge },
  ];
  return (
    <Page
      title="ダッシュボード"
      description="獲得・自動化・配信の現在地を確認します。"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardAction>
                <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                  <card.icon className="size-4" />
                </div>
              </CardAction>
              <CardTitle className="text-3xl font-semibold tabular-nums">
                {card.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="min-h-80">
          <CardHeader>
            <CardTitle>配信ヘルス</CardTitle>
            <CardDescription>直近7期間の配信到達率</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-44 items-end gap-3">
              {[45, 56, 38, 70, 62, 83, Math.max(12, deliveredRate)].map(
                (height, index) => (
                  <div
                    key={index}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <div
                      className="w-full rounded-t-md bg-primary"
                      style={{
                        height: `${height}%`,
                        opacity: 0.45 + index * 0.08,
                      }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最近のイベント</CardTitle>
            <CardDescription>
              ワークスペースの最新アクティビティ
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentEvents.length === 0 ? (
              <Empty compact label="まだイベントがありません" />
            ) : (
              data.recentEvents.slice(0, 8).map((event, index) => (
                <div key={`${event.occurred_at}-${index}`}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex gap-3 py-3">
                    <span className="mt-1 size-2 rounded-full bg-success" />
                    <div>
                      <div className="text-sm font-medium">{event.type}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(event.occurred_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

interface SegmentRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  member_count: number;
  updated_at: string;
}

export function SegmentsPage(): ReactNode {
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(() => {
    void api<SegmentRow[]>("/segments").then((response) =>
      setSegments(response.data),
    );
  }, []);
  useEffect(load, [load]);
  return (
    <Page
      title="セグメント"
      description="属性・タグ・行動・同意を組み合わせた安全な動的条件です。"
      action={
        <Button onClick={() => setShowForm(true)}>
          <Plus data-icon="inline-start" />
          セグメントを作成
        </Button>
      }
    >
      <ResourceGrid>
        {segments.map((segment) => (
          <ResourceCard
            key={segment.id}
            icon={<Shapes />}
            title={segment.name}
            subtitle={`${segment.kind} · ${segment.member_count} contacts`}
            footer={formatDate(segment.updated_at)}
          />
        ))}
      </ResourceGrid>
      {segments.length === 0 && (
        <Empty label="最初のセグメントを作成しましょう" />
      )}
      {showForm && (
        <AppDialog
          open={showForm}
          onOpenChange={setShowForm}
          title="動的セグメント"
          description="属性や行動条件から更新されるセグメントを作成します。"
        >
          <SegmentForm
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        </AppDialog>
      )}
    </Page>
  );
}

function SegmentForm({ onSaved }: { onSaved: () => void }): ReactNode {
  const [field, setField] = useState("stage");
  const [operator, setOperator] = useState("eq");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const filter: SegmentFilter = {
      kind: "condition",
      field: field as Extract<SegmentFilter, { kind: "condition" }>["field"],
      operator: operator as Extract<
        SegmentFilter,
        { kind: "condition" }
      >["operator"],
      value: String(form.get("value")),
    };
    setBusy(true);
    await api("/segments", {
      method: "POST",
      body: JSON.stringify({
        name,
        slug: slugify(name),
        kind: "dynamic",
        filter,
      }),
    });
    setBusy(false);
    onSaved();
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-5"
    >
      <Field label="名前" name="name" required />
      <div className="grid grid-cols-2 gap-3">
        <FormNativeSelect
          label="フィールド"
          name="field"
          value={field}
          onChange={(event) => setField(event.target.value)}
        >
          {contactAttributeDefinitions.map((attribute) => (
            <FormSelectOption key={attribute.key} value={attribute.key}>
              {attribute.label}
            </FormSelectOption>
          ))}
          <FormSelectOption value="company">アカウント</FormSelectOption>
          <FormSelectOption value="tag">タグ</FormSelectOption>
          <FormSelectOption value="event">イベント</FormSelectOption>
        </FormNativeSelect>
        <FormNativeSelect
          label="演算子"
          name="operator"
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
        >
          <FormSelectOption value="eq">等しい</FormSelectOption>
          <FormSelectOption value="neq">等しくない</FormSelectOption>
          <FormSelectOption value="contains">含む</FormSelectOption>
          <FormSelectOption value="gte">以上</FormSelectOption>
        </FormNativeSelect>
      </div>
      <Field label="値" name="value" required />
      <LoadingButton busy={busy} className="w-full" type="submit">
        作成
      </LoadingButton>
    </form>
  );
}

interface CampaignRow {
  id: string;
  name: string;
  description: string;
  status: string;
  updated_at: string;
}

export function CampaignsPage(): ReactNode {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const navigate = useNavigate();
  const load = useCallback(() => {
    void api<CampaignRow[]>("/campaigns").then((response) =>
      setCampaigns(response.data),
    );
  }, []);
  useEffect(load, [load]);
  async function createCampaign() {
    const definition = starterCampaign(`New campaign ${campaigns.length + 1}`);
    const response = await api<{ id: string }>("/campaigns", {
      method: "POST",
      body: JSON.stringify(definition),
    });
    await navigate({
      to: "/campaigns/$id",
      params: { id: response.data.id },
    });
  }
  return (
    <Page
      title="キャンペーン"
      description="SourceからDecision、Delay、Actionへつながる不変バージョンの自動化です。"
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
              footer={formatDate(campaign.updated_at)}
            />
          </Button>
        ))}
      </ResourceGrid>
      {campaigns.length === 0 && (
        <Empty label="最初のキャンペーンを作成しましょう" />
      )}
    </Page>
  );
}

export function CampaignBuilder({ id }: { id: string }): ReactNode {
  const [definition, setDefinition] = useState<CampaignDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void api<{ graph: CampaignDefinition }>(`/campaigns/${id}/draft`).then(
      (response) => setDefinition(response.data.graph),
    );
  }, [id]);
  const flowNodes: Node[] = useMemo(
    () =>
      (definition?.nodes ?? []).map((node) => ({
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
      (definition?.edges ?? []).map((edge) => ({
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
      if (!definition) return;
      const changed = applyNodeChanges(changes, flowNodes);
      setDefinition({
        ...definition,
        nodes: definition.nodes.map((node) => {
          const flow = changed.find((item) => item.id === node.id);
          return flow ? { ...node, position: flow.position } : node;
        }),
      });
    },
    [definition, flowNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!definition) return;
      const changed = applyEdgeChanges(changes, flowEdges);
      setDefinition({
        ...definition,
        edges: changed.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          branch:
            (edge.data?.["branch"] as CampaignEdge["branch"] | undefined) ??
            "next",
        })),
      });
    },
    [definition, flowEdges],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!definition || !connection.source || !connection.target) return;
      const source = definition.nodes.find(
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
      setDefinition({
        ...definition,
        edges: added.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          branch:
            (edge.data?.["branch"] as CampaignEdge["branch"] | undefined) ??
            "next",
        })),
      });
    },
    [definition, flowEdges],
  );
  async function save(publish = false) {
    if (!definition) return;
    setSaving(true);
    setNotice("");
    try {
      await api(`/campaigns/${id}/draft`, {
        method: "PUT",
        body: JSON.stringify(definition),
      });
      if (publish) {
        await api(`/campaigns/${id}/publish`, { method: "POST" });
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
  if (!definition) return <PageLoading />;
  return (
    <div className="-m-4 lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-4 lg:px-8">
        <div>
          <Input
            aria-label="キャンペーン名"
            className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
            value={definition.name}
            onChange={(event) =>
              setDefinition({ ...definition, name: event.target.value })
            }
          />
          <div className="text-xs text-muted-foreground">
            Draft · {definition.timezone}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {notice && (
            <span className="text-sm text-muted-foreground">{notice}</span>
          )}
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
          nodeTypes={{ campaign: CampaignFlowNode }}
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
      {node.type !== "source" && (
        <Handle type="target" position={Position.Left} />
      )}
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

interface FormRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  updated_at: string;
}

export function FormsPage(): ReactNode {
  const [items, setItems] = useState<FormRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(() => {
    void api<FormRow[]>("/forms").then((response) => setItems(response.data));
  }, []);
  useEffect(load, [load]);
  return (
    <Page
      title="フォーム"
      description="Turnstile、honeypot、許可ドメイン、二重送信防止を組み込んだ獲得面です。"
      action={
        <Button onClick={() => setShowForm(true)}>
          <Plus data-icon="inline-start" />
          フォーム
        </Button>
      }
    >
      <ResourceGrid>
        {items.map((item) => (
          <ResourceCard
            key={item.id}
            icon={<LayoutTemplate />}
            title={item.name}
            subtitle={`${item.status} · /${item.slug}`}
            footer={formatDate(item.updated_at)}
          />
        ))}
      </ResourceGrid>
      {items.length === 0 && <Empty label="フォームがありません" />}
      {showForm && (
        <AppDialog
          open={showForm}
          onOpenChange={setShowForm}
          title="フォームを作成"
          description="連絡先を獲得する公開フォームを作成します。"
        >
          <SimpleResourceForm
            buttonLabel="フォームを公開"
            onSubmit={async (name) => {
              await api("/forms", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  slug: slugify(name),
                  status: "published",
                  definition: {
                    fields: [
                      { key: "email", type: "email", required: true },
                      { key: "firstName", type: "text", required: false },
                    ],
                  },
                  allowedDomains: [],
                  turnstileEnabled: true,
                }),
              });
              setShowForm(false);
              load();
            }}
          />
        </AppDialog>
      )}
    </Page>
  );
}

export function SettingsPage(): ReactNode {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace context is missing");
  const [apiKey, setApiKey] = useState("");
  const [providerSaved, setProviderSaved] = useState(false);
  async function createKey() {
    const response = await api<{ token: string }>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Admin generated key", role: "marketer" }),
    });
    setApiKey(response.data.token);
  }
  async function saveResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/providers/resend", {
      method: "POST",
      body: JSON.stringify({
        apiKey: form.get("apiKey"),
        webhookSecret: form.get("webhookSecret"),
      }),
    });
    setProviderSaved(true);
    toast.success("Resend設定を保存しました");
  }
  return (
    <Page
      title="設定"
      description="チャネル資格情報はAES-GCMで暗号化してD1へ保存します。"
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <TwoFactorSettings />
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <Mail />
              </div>
              <div>
                <CardTitle>Resend Marketing Email</CardTitle>
                <CardDescription>
                  マーケティングメールの配信資格情報
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-5">
              <p className="text-sm text-muted-foreground">
                Webhook URL:{" "}
                <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">
                  {`/api/webhooks/resend/${workspace.id}`}
                </code>
              </p>
              <form
                onSubmit={(event) => void saveResend(event)}
                className="flex flex-col gap-5"
              >
                <Field label="API key" name="apiKey" type="password" required />
                <Field
                  label="Webhook signing secret"
                  name="webhookSecret"
                  type="password"
                  required
                />
                {providerSaved && <SuccessMessage>保存しました</SuccessMessage>}
                <Button type="submit">暗号化して保存</Button>
              </form>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <KeyRound />
              </div>
              <div>
                <CardTitle>Workspace APIキー</CardTitle>
                <CardDescription>
                  SDK/MCP用。キーは作成時に一度だけ表示されます。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <Button variant="outline" onClick={() => void createKey()}>
              APIキーを作成
            </Button>
            {apiKey && (
              <pre className="w-full overflow-x-auto rounded-lg bg-muted p-4 text-xs">
                {apiKey}
              </pre>
            )}
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>現在のワークスペース情報</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono">{workspace.id}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Slug</dt>
                <dd>{workspace.slug}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Timezone</dt>
                <dd>{workspace.timezone}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

function TwoFactorSettings(): ReactNode {
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [verified, setVerified] = useState(false);
  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    const result = await authClient.twoFactor.enable({
      password,
      issuer: "Kaenma",
    });
    if (result.data) setSetup(result.data);
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code"));
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.data) setVerified(true);
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <KeyRound />
          </div>
          <div>
            <CardTitle>TOTP 二要素認証</CardTitle>
            <CardDescription>
              認証アプリを利用してログインを保護します。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!setup ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => void enable(event)}
          >
            <Field
              label="現在のパスワード"
              name="password"
              type="password"
              required
            />
            <Button variant="outline" type="submit">
              セットアップを開始
            </Button>
          </form>
        ) : verified ? (
          <SuccessMessage>
            TOTPを有効にしました。バックアップコードを安全に保管してください。
          </SuccessMessage>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs">
              {setup.totpURI}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {setup.backupCodes.join("\n")}
            </pre>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => void verify(event)}
            >
              <Field
                label="認証コード"
                name="code"
                inputMode="numeric"
                placeholder="6桁コード"
                required
              />
              <Button type="submit">確認</Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuthScreen(): ReactNode {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name")),
          });
    setBusy(false);
    if (
      mode === "signin" &&
      result.data &&
      "twoFactorRedirect" in result.data &&
      result.data.twoFactorRedirect
    ) {
      setTwoFactorPending(true);
    } else if (result.error) {
      setError(result.error.message ?? "認証できませんでした");
    } else if (mode === "signup" && result.data?.token) {
      window.location.reload();
    } else if (mode === "signup") {
      setMode("signin");
      setNotice(
        "アカウントを作成しました。確認メールのリンクを開いてからログインしてください。",
      );
    } else {
      window.location.reload();
    }
  }
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <div className="hidden border-r bg-muted/40 p-14 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Blocks />
          </div>
          <span className="font-heading text-xl font-semibold">Kaenma</span>
        </div>
        <div className="flex flex-col items-start gap-6">
          <Badge variant="outline">
            Cloudflare-native marketing automation
          </Badge>
          <h1 className="max-w-2xl font-heading text-5xl font-semibold leading-[1.08] tracking-tight">
            獲得から配信まで、エッジで自動化。
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            D1、Queues、R2、Email Serviceを一つのWorkerに統合した、
            オープンソースのマーケティング基盤です。
          </p>
        </div>
        <div className="flex gap-8 text-sm text-muted-foreground">
          <span>MIT License</span>
          <span>TypeScript</span>
          <span>Cloudflare Workers</span>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 lg:hidden">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Blocks />
              </div>
              <span className="font-heading font-semibold">Kaenma</span>
            </div>
            <CardTitle className="text-2xl">
              {mode === "signin" ? "おかえりなさい" : "アカウントを作成"}
            </CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "ワークスペースへログインします。"
                : "アカウントを作成します。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {twoFactorPending ? (
              <form
                className="flex flex-col gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const code = String(
                    new FormData(event.currentTarget).get("code"),
                  );
                  setBusy(true);
                  void authClient.twoFactor
                    .verifyTotp({ code, trustDevice: true })
                    .then((result) => {
                      if (result.error)
                        setError(result.error.message ?? "コードが無効です");
                      else window.location.reload();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Field label="認証アプリの6桁コード" name="code" required />
                {error && <ErrorMessage>{error}</ErrorMessage>}
                <LoadingButton busy={busy} className="w-full" type="submit">
                  確認してログイン
                </LoadingButton>
              </form>
            ) : (
              <form
                onSubmit={(event) => void submit(event)}
                className="flex flex-col gap-5"
              >
                {mode === "signup" && (
                  <Field label="名前" name="name" required />
                )}
                <Field
                  label="メールアドレス"
                  name="email"
                  type="email"
                  required
                />
                <Field
                  label="パスワード（12文字以上）"
                  name="password"
                  type="password"
                  minLength={12}
                  required
                />
                {notice && <SuccessMessage>{notice}</SuccessMessage>}
                {error && <ErrorMessage>{error}</ErrorMessage>}
                <LoadingButton busy={busy} className="w-full" type="submit">
                  {mode === "signin" ? "ログイン" : "登録"}
                </LoadingButton>
              </form>
            )}
            <Button
              variant="link"
              className="self-start px-0"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setNotice("");
              }}
            >
              {mode === "signin" ? "新しいアカウントを作成" : "ログインへ戻る"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WorkspaceSetup({ onCreated }: { onCreated: () => void }): ReactNode {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const result = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    if (result.error) {
      setError(result.error.message ?? "作成できませんでした");
      return;
    }
    if (result.data?.id) {
      await authClient.organization.setActive({
        organizationId: result.data.id,
      });
    }
    onCreated();
  }
  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UsersRound />
          </div>
          <CardTitle className="text-2xl">ワークスペースを作成</CardTitle>
          <CardDescription>
            OrganizationがKaenmaのWorkspaceになります。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-5"
          >
            <Field label="ワークスペース名" name="name" required />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <Button className="w-full" type="submit">
              作成して開始
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function FullScreenStatus({ label }: { label: string }): ReactNode {
  return <PageLoading label={label} />;
}

function SimpleResourceForm({
  onSubmit,
  buttonLabel,
}: {
  onSubmit: (name: string) => Promise<void>;
  buttonLabel: string;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get("name"));
        setBusy(true);
        void onSubmit(name).finally(() => setBusy(false));
      }}
    >
      <Field label="名前" name="name" required />
      <LoadingButton busy={busy} className="w-full" type="submit">
        {buttonLabel}
      </LoadingButton>
    </form>
  );
}

function starterCampaign(name: string): CampaignDefinition {
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

function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return normalized || `resource-${Date.now()}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

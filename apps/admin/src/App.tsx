import type {
  CampaignDefinition,
  CampaignEdge,
  CampaignNode,
  Contact,
  ContentDocument,
  SegmentFilter,
} from "@kaenma/shared";
import {
  Link,
  Outlet,
  linkOptions,
  useNavigate,
} from "@tanstack/react-router";
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
  Blocks,
  ContactRound,
  FileText,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Mail,
  Menu,
  Plus,
  Save,
  Search,
  Send,
  Settings,
  Shapes,
  UsersRound,
  X,
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
  if (session.isPending) return <FullScreenStatus label="セッションを確認しています…" />;
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
        if (error instanceof ApiClientError && error.code === "workspace_required") {
          setNeedsWorkspace(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <FullScreenStatus label="ワークスペースを読み込んでいます…" />;
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigation = linkOptions([
    { to: "/dashboard", label: "ダッシュボード", icon: Gauge },
    { to: "/contacts", label: "連絡先", icon: ContactRound },
    { to: "/segments", label: "セグメント", icon: Shapes },
    { to: "/campaigns", label: "キャンペーン", icon: GitBranch },
    { to: "/emails", label: "メール", icon: Mail },
    { to: "/forms", label: "フォーム", icon: FileText },
    { to: "/settings", label: "設定", icon: Settings },
  ]);
  return (
    <div className="min-h-screen bg-cloud">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-68 border-r border-slate-200 bg-[#151927] text-white transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-18 items-center justify-between border-b border-white/10 px-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-brand">
              <Blocks className="size-5" />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight">Kaenma</div>
              <div className="max-w-38 truncate text-xs text-slate-400">{workspace.name}</div>
            </div>
          </div>
          <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="閉じる">
            <X />
          </button>
        </div>
        <nav className="space-y-1 p-3">
          {navigation.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
              activeProps={{ className: "bg-white/12 text-white" }}
              inactiveProps={{
                className: "text-slate-400 hover:bg-white/6 hover:text-white",
              }}
            >
              <item.icon className="size-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute inset-x-3 bottom-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-400">Cloudflare native</span>
            <span className="rounded-full bg-mint/15 px-2 py-0.5 text-mint">Online</span>
          </div>
          <div className="text-xs text-slate-500">Role: {workspace.role}</div>
        </div>
      </aside>
      <div className="lg:pl-68">
        <header className="sticky top-0 z-30 flex h-18 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur lg:px-8">
          <button className="button-secondary !p-2 lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </button>
          <div className="hidden text-sm text-slate-500 sm:block">
            {workspace.name} <span className="mx-2">/</span> {workspace.timezone}
          </div>
          <button
            className="button-secondary"
            onClick={() => {
              void authClient.signOut().then(() => window.location.reload());
            }}
          >
            <LogOut className="size-4" /> ログアウト
          </button>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 lg:p-8">
          <WorkspaceContext.Provider value={workspace}>
            <Outlet />
          </WorkspaceContext.Provider>
        </main>
      </div>
    </div>
  );
}

export function Dashboard(): ReactNode {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => {
    void api<DashboardData>("/dashboard").then((response) => setData(response.data));
  }, []);
  if (!data) return <PageLoading />;
  const deliveredRate =
    data.deliveries.sent > 0
      ? Math.round((data.deliveries.delivered / data.deliveries.sent) * 1000) / 10
      : 0;
  const cards = [
    { label: "アクティブ連絡先", value: data.contacts.count.toLocaleString(), icon: UsersRound },
    { label: "公開キャンペーン", value: data.campaigns.count.toLocaleString(), icon: Activity },
    { label: "30日間の配信", value: data.deliveries.sent.toLocaleString(), icon: Send },
    { label: "配信到達率", value: `${deliveredRate}%`, icon: Gauge },
  ];
  return (
    <Page title="ダッシュボード" description="獲得・自動化・配信の現在地を確認します。">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card p-5">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm text-slate-500">{card.label}</span>
              <span className="grid size-10 place-items-center rounded-xl bg-brand/8 text-brand">
                <card.icon className="size-5" />
              </span>
            </div>
            <div className="text-3xl font-bold tracking-tight">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="card min-h-80 p-6">
          <h2 className="font-semibold">配信ヘルス</h2>
          <div className="mt-8 flex h-44 items-end gap-3">
            {[45, 56, 38, 70, 62, 83, Math.max(12, deliveredRate)].map((height, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-brand to-[#9b83ff]"
                  style={{ height: `${height}%` }}
                />
                <span className="text-xs text-slate-400">{index + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-6">
          <h2 className="font-semibold">最近のイベント</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {data.recentEvents.length === 0 ? (
              <Empty compact label="まだイベントがありません" />
            ) : (
              data.recentEvents.slice(0, 8).map((event, index) => (
                <div key={`${event.occurred_at}-${index}`} className="flex gap-3 py-3">
                  <span className="mt-1 size-2 rounded-full bg-mint" />
                  <div>
                    <div className="text-sm font-medium">{event.type}</div>
                    <div className="text-xs text-slate-400">{formatDate(event.occurred_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}

export function ContactsPage(): ReactNode {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(() => {
    void api<Contact[]>(`/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`).then(
      (response) => setContacts(response.data),
    );
  }, [query]);
  useEffect(load, [load]);
  return (
    <Page
      title="連絡先"
      description="既知Contactと匿名訪問者を一つのタイムラインで管理します。"
      action={
        <button className="button-primary" onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> 連絡先を追加
        </button>
      }
    >
      <div className="card overflow-hidden">
        <div className="flex items-center border-b border-slate-100 p-4">
          <Search className="ml-1 size-4 text-slate-400" />
          <input
            className="w-full bg-transparent px-3 text-sm outline-none"
            placeholder="名前、メールアドレスで検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Stage</th>
                <th className="px-5 py-3">Score</th>
                <th className="px-5 py-3">更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <div className="font-medium">
                      {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                        contact.email ||
                        "匿名Contact"}
                    </div>
                    <div className="text-xs text-slate-400">{contact.email}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                      {contact.stage}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-semibold">{contact.score}</td>
                  <td className="px-5 py-4 text-slate-500">{formatDate(contact.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {contacts.length === 0 && <Empty label="連絡先がまだありません" />}
        </div>
      </div>
      {showForm && (
        <Modal title="連絡先を追加" onClose={() => setShowForm(false)}>
          <ContactForm
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        </Modal>
      )}
    </Page>
  );
}

function ContactForm({ onSaved }: { onSaved: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/contacts", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          firstName: form.get("firstName") || undefined,
          lastName: form.get("lastName") || undefined,
          customFields: {},
        }),
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field label="メールアドレス" name="email" type="email" required />
      <div className="grid grid-cols-2 gap-3">
        <Field label="名" name="firstName" />
        <Field label="姓" name="lastName" />
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <button className="button-primary w-full" disabled={busy}>
        {busy ? "保存中…" : "保存"}
      </button>
    </form>
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
    void api<SegmentRow[]>("/segments").then((response) => setSegments(response.data));
  }, []);
  useEffect(load, [load]);
  return (
    <Page
      title="セグメント"
      description="属性・タグ・行動・同意を組み合わせた安全な動的条件です。"
      action={
        <button className="button-primary" onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> セグメントを作成
        </button>
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
      {segments.length === 0 && <Empty label="最初のセグメントを作成しましょう" />}
      {showForm && (
        <Modal title="動的セグメント" onClose={() => setShowForm(false)}>
          <SegmentForm
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        </Modal>
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
      operator: operator as Extract<SegmentFilter, { kind: "condition" }>["operator"],
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
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field label="名前" name="name" required />
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">フィールド</span>
          <select className="field" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="stage">Stage</option>
            <option value="score">Score</option>
            <option value="email">Email</option>
            <option value="tag">Tag</option>
            <option value="event">Event</option>
          </select>
        </label>
        <label>
          <span className="label">演算子</span>
          <select
            className="field"
            value={operator}
            onChange={(event) => setOperator(event.target.value)}
          >
            <option value="eq">等しい</option>
            <option value="neq">等しくない</option>
            <option value="contains">含む</option>
            <option value="gte">以上</option>
          </select>
        </label>
      </div>
      <Field label="値" name="value" required />
      <button className="button-primary w-full" disabled={busy}>作成</button>
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
    void api<CampaignRow[]>("/campaigns").then((response) => setCampaigns(response.data));
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
        <button className="button-primary" onClick={() => void createCampaign()}>
          <Plus className="size-4" /> キャンペーンを作成
        </button>
      }
    >
      <ResourceGrid>
        {campaigns.map((campaign) => (
          <button
            key={campaign.id}
            className="text-left"
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
          </button>
        ))}
      </ResourceGrid>
      {campaigns.length === 0 && <Empty label="最初のキャンペーンを作成しましょう" />}
    </Page>
  );
}

export function CampaignBuilder({ id }: { id: string }): ReactNode {
  const [definition, setDefinition] = useState<CampaignDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void api<{ graph: CampaignDefinition }>(`/campaigns/${id}/draft`).then((response) =>
      setDefinition(response.data.graph),
    );
  }, [id]);
  const flowNodes: Node[] = useMemo(
    () =>
      (definition?.nodes ?? []).map((node) => ({
        id: node.id,
        position: node.position,
        type: "campaign",
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
          branch: (edge.data?.["branch"] as CampaignEdge["branch"] | undefined) ?? "next",
        })),
      });
    },
    [definition, flowEdges],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!definition || !connection.source || !connection.target) return;
      const source = definition.nodes.find((node) => node.id === connection.source);
      const branch: CampaignEdge["branch"] =
        source?.type === "condition" || source?.type === "decision" ? "yes" : "next";
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
          branch: (edge.data?.["branch"] as CampaignEdge["branch"] | undefined) ?? "next",
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
      } else {
        setNotice("下書きを保存しました");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }
  if (!definition) return <PageLoading />;
  return (
    <div className="-m-4 lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 lg:px-8">
        <div>
          <input
            className="text-xl font-bold outline-none"
            value={definition.name}
            onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
          />
          <div className="text-xs text-slate-400">Draft · {definition.timezone}</div>
        </div>
        <div className="flex items-center gap-2">
          {notice && <span className="text-sm text-slate-500">{notice}</span>}
          <button className="button-secondary" disabled={saving} onClick={() => void save()}>
            <Save className="size-4" /> 保存
          </button>
          <button className="button-primary" disabled={saving} onClick={() => void save(true)}>
            <Send className="size-4" /> 公開
          </button>
        </div>
      </div>
      <div className="h-[calc(100vh-8.5rem)] bg-[#eef1f7]">
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

function CampaignFlowNode({ data }: NodeProps<Node<{ node: CampaignNode }>>): ReactNode {
  const node = data.node;
  const colors: Record<CampaignNode["type"], string> = {
    source: "border-mint",
    action: "border-brand",
    condition: "border-amber-400",
    decision: "border-pink-400",
    delay: "border-sky-400",
  };
  const label =
    node.type === "action"
      ? node.config.action.replaceAll("_", " ")
      : node.type === "source"
        ? node.config.source.replaceAll("_", " ")
        : node.type;
  return (
    <div className={`flow-node ${colors[node.type]}`}>
      {node.type !== "source" && <Handle type="target" position={Position.Left} />}
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {node.type}
      </div>
      <div className="mt-1 text-sm font-semibold capitalize">{label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

interface TemplateRow {
  id: string;
  name: string;
  purpose: string;
  status: string;
  updated_at: string;
}

export function EmailsPage(): ReactNode {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(() => {
    void api<TemplateRow[]>("/email-templates").then((response) => setItems(response.data));
  }, []);
  useEffect(load, [load]);
  return (
    <Page
      title="メール"
      description="TransactionalとMarketingを型・プロバイダーごとに明確に分離します。"
      action={
        <button className="button-primary" onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> テンプレート
        </button>
      }
    >
      <ResourceGrid>
        {items.map((item) => (
          <ResourceCard
            key={item.id}
            icon={<Mail />}
            title={item.name}
            subtitle={`${item.purpose} · ${item.status}`}
            footer={formatDate(item.updated_at)}
          />
        ))}
      </ResourceGrid>
      {items.length === 0 && <Empty label="メールテンプレートがありません" />}
      {showForm && (
        <Modal title="メールテンプレート" onClose={() => setShowForm(false)}>
          <EmailForm
            onSaved={() => {
              setShowForm(false);
              load();
            }}
          />
        </Modal>
      )}
    </Page>
  );
}

function EmailForm({ onSaved }: { onSaved: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const content: ContentDocument = {
      schemaVersion: 1,
      backgroundColor: "#f4f5f7",
      contentColor: "#ffffff",
      width: 600,
      blocks: [
        {
          id: crypto.randomUUID(),
          type: "text",
          html: `<h1>${String(form.get("headline"))}</h1><p>{{ contact.first_name }}さん、こんにちは。</p>`,
        },
        {
          id: crypto.randomUUID(),
          type: "button",
          label: "詳しく見る",
          href: "https://example.com",
          color: "#6d4aff",
        },
      ],
    };
    setBusy(true);
    await api("/email-templates", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        purpose: form.get("purpose"),
        subject: form.get("subject"),
        previewText: "",
        content,
      }),
    });
    setBusy(false);
    onSaved();
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field label="名前" name="name" required />
      <Field label="件名" name="subject" required />
      <Field label="見出し" name="headline" required />
      <label>
        <span className="label">用途</span>
        <select className="field" name="purpose" defaultValue="marketing">
          <option value="marketing">Marketing（Resend）</option>
          <option value="transactional">Transactional（Cloudflare）</option>
        </select>
      </label>
      <button className="button-primary w-full" disabled={busy}>作成</button>
    </form>
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
        <button className="button-primary" onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> フォーム
        </button>
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
        <Modal title="フォームを作成" onClose={() => setShowForm(false)}>
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
        </Modal>
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
  }
  return (
    <Page title="設定" description="チャネル資格情報はAES-GCMで暗号化してD1へ保存します。">
      <div className="grid gap-6 xl:grid-cols-2">
        <TwoFactorSettings />
        <section className="card p-6">
          <div className="mb-5 flex items-center gap-3">
            <Mail className="size-5 text-brand" />
            <h2 className="font-semibold">Resend Marketing Email</h2>
          </div>
          <p className="mb-5 text-sm text-slate-500">
            Webhook URL:{" "}
            <code className="break-all">{`/api/webhooks/resend/${workspace.id}`}</code>
          </p>
          <form onSubmit={(event) => void saveResend(event)} className="space-y-4">
            <Field label="API key" name="apiKey" type="password" required />
            <Field label="Webhook signing secret" name="webhookSecret" type="password" required />
            {providerSaved && <SuccessMessage>保存しました</SuccessMessage>}
            <button className="button-primary">暗号化して保存</button>
          </form>
        </section>
        <section className="card p-6">
          <div className="mb-2 flex items-center gap-3">
            <KeyRound className="size-5 text-brand" />
            <h2 className="font-semibold">Workspace APIキー</h2>
          </div>
          <p className="mb-5 text-sm text-slate-500">
            SDK/MCP用。キーは作成時に一度だけ表示されます。
          </p>
          <button className="button-secondary" onClick={() => void createKey()}>
            APIキーを作成
          </button>
          {apiKey && (
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-300">
              {apiKey}
            </pre>
          )}
        </section>
        <section className="card p-6 xl:col-span-2">
          <h2 className="font-semibold">Workspace</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-400">ID</dt><dd className="mt-1 font-mono">{workspace.id}</dd></div>
            <div><dt className="text-slate-400">Slug</dt><dd className="mt-1">{workspace.slug}</dd></div>
            <div><dt className="text-slate-400">Timezone</dt><dd className="mt-1">{workspace.timezone}</dd></div>
          </dl>
        </section>
      </div>
    </Page>
  );
}

function TwoFactorSettings(): ReactNode {
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [verified, setVerified] = useState(false);
  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    const result = await authClient.twoFactor.enable({ password, issuer: "Kaenma" });
    if (result.data) setSetup(result.data);
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code"));
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.data) setVerified(true);
  }
  return (
    <section className="card p-6">
      <div className="mb-2 flex items-center gap-3">
        <KeyRound className="size-5 text-brand" />
        <h2 className="font-semibold">TOTP 二要素認証</h2>
      </div>
      {!setup ? (
        <form className="mt-5 space-y-4" onSubmit={(event) => void enable(event)}>
          <Field label="現在のパスワード" name="password" type="password" required />
          <button className="button-secondary">セットアップを開始</button>
        </form>
      ) : verified ? (
        <SuccessMessage>TOTPを有効にしました。バックアップコードを安全に保管してください。</SuccessMessage>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="break-all rounded-xl bg-slate-50 p-3 font-mono text-xs">{setup.totpURI}</p>
          <pre className="rounded-xl bg-slate-950 p-3 text-xs text-emerald-300">{setup.backupCodes.join("\n")}</pre>
          <form className="flex gap-2" onSubmit={(event) => void verify(event)}>
            <input className="field" name="code" inputMode="numeric" placeholder="6桁コード" required />
            <button className="button-primary">確認</button>
          </form>
        </div>
      )}
    </section>
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
      setNotice("アカウントを作成しました。確認メールのリンクを開いてからログインしてください。");
    } else {
      window.location.reload();
    }
  }
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden overflow-hidden bg-[#151927] p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-brand"><Blocks /></div>
          <span className="text-xl font-bold">Kaenma</span>
        </div>
        <div>
          <div className="mb-8 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            Cloudflare-native marketing automation
          </div>
          <h1 className="max-w-2xl text-5xl font-bold leading-[1.1] tracking-tight">
            獲得から配信まで、
            <span className="text-[#9b83ff]">エッジで自動化。</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
            D1、Queues、R2、Email Serviceを一つのWorkerに統合した、
            オープンソースのマーケティング基盤です。
          </p>
        </div>
        <div className="flex gap-8 text-sm text-slate-500">
          <span>MIT License</span><span>TypeScript</span><span>Cloudflare Workers</span>
        </div>
      </div>
      <div className="flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-xl font-bold"><Blocks className="text-brand" />Kaenma</div>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">
            {mode === "signin" ? "おかえりなさい" : "アカウントを作成"}
          </h2>
          <p className="mt-2 text-slate-500">
            {mode === "signin" ? "ワークスペースへログインします。" : "アカウントを作成します。"}
          </p>
          {twoFactorPending ? (
            <form
              className="mt-8 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const code = String(new FormData(event.currentTarget).get("code"));
                setBusy(true);
                void authClient.twoFactor
                  .verifyTotp({ code, trustDevice: true })
                  .then((result) => {
                    if (result.error) setError(result.error.message ?? "コードが無効です");
                    else window.location.reload();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <Field label="認証アプリの6桁コード" name="code" required />
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <button className="button-primary w-full py-3" disabled={busy}>確認してログイン</button>
            </form>
          ) : <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-4">
            {mode === "signup" && <Field label="名前" name="name" required />}
            <Field label="メールアドレス" name="email" type="email" required />
            <Field label="パスワード（12文字以上）" name="password" type="password" minLength={12} required />
            {notice && <SuccessMessage>{notice}</SuccessMessage>}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <button className="button-primary w-full py-3" disabled={busy}>
              {busy ? "処理中…" : mode === "signin" ? "ログイン" : "登録"}
            </button>
          </form>}
          <button
            className="mt-6 text-sm font-medium text-brand"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
          >
            {mode === "signin" ? "新しいアカウントを作成" : "ログインへ戻る"}
          </button>
        </div>
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
    const result = await authClient.organization.create({ name, slug: slugify(name) });
    if (result.error) {
      setError(result.error.message ?? "作成できませんでした");
      return;
    }
    if (result.data?.id) {
      await authClient.organization.setActive({ organizationId: result.data.id });
    }
    onCreated();
  }
  return (
    <div className="grid min-h-screen place-items-center bg-cloud p-6">
      <div className="card w-full max-w-lg p-8">
        <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-brand text-white">
          <UsersRound />
        </div>
        <h1 className="text-2xl font-bold">ワークスペースを作成</h1>
        <p className="mt-2 text-sm text-slate-500">OrganizationがKaenmaのWorkspaceになります。</p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <Field label="ワークスペース名" name="name" required />
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <button className="button-primary w-full">作成して開始</button>
        </form>
      </div>
    </div>
  );
}

function Page({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1><p className="mt-2 text-sm text-slate-500">{description}</p></div>
        {action}
      </div>
      {children}
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  ...props
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
}): ReactNode {
  return <label><span className="label">{label}</span><input className="field" name={name} type={type} {...props} /></label>;
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card w-full max-w-lg p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose}><X className="size-5 text-slate-400" /></button></div>
        {children}
      </div>
    </div>
  );
}

function ResourceGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function ResourceCard({
  icon,
  title,
  subtitle,
  footer,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  footer: string;
}): ReactNode {
  return (
    <div className="card group p-5 transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="grid size-11 place-items-center rounded-xl bg-brand/8 text-brand [&>svg]:size-5">{icon}</div>
        <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{title}</h3><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
      </div>
      <div className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-400">{footer}</div>
    </div>
  );
}

function Empty({ label, compact = false }: { label: string; compact?: boolean }): ReactNode {
  return <div className={`text-center text-sm text-slate-400 ${compact ? "py-8" : "card mt-4 py-16"}`}><Blocks className="mx-auto mb-3 size-7 opacity-40" />{label}</div>;
}

function PageLoading(): ReactNode {
  return <div className="grid min-h-72 place-items-center text-sm text-slate-400">読み込み中…</div>;
}

function FullScreenStatus({ label }: { label: string }): ReactNode {
  return <div className="grid min-h-screen place-items-center bg-cloud text-sm text-slate-500">{label}</div>;
}

function ErrorMessage({ children }: { children: ReactNode }): ReactNode {
  return <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>;
}

function SuccessMessage({ children }: { children: ReactNode }): ReactNode {
  return <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{children}</div>;
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
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get("name"));
        setBusy(true);
        void onSubmit(name).finally(() => setBusy(false));
      }}
    >
      <Field label="名前" name="name" required />
      <button className="button-primary w-full" disabled={busy}>{buttonLabel}</button>
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
    edges: [{ id: "source-score", source: "source", target: "score", branch: "next" }],
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

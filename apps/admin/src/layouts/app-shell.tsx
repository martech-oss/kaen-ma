import { authClient } from "@/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { Workspace } from "@/lib/workspace";
import {
  Link,
  Outlet,
  linkOptions,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  Archive,
  Blocks,
  Braces,
  Building2,
  ContactRound,
  FileText,
  Gauge,
  GitBranch,
  ListChecks,
  LogOut,
  Mail,
  Send,
  Settings,
  Shapes,
  Tags,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

const dashboardNavigation = linkOptions([
  { to: "/dashboard", label: "ダッシュボード", icon: Gauge },
]);

const contactNavigation = linkOptions([
  { to: "/contacts", label: "連絡先", icon: UsersRound },
  { to: "/contacts/accounts", label: "アカウント", icon: Building2 },
  { to: "/contacts/lists", label: "リスト", icon: ListChecks },
  { to: "/contacts/tags", label: "タグ", icon: Tags },
  { to: "/contacts/segments", label: "セグメント", icon: Shapes },
]);

const automationNavigation = linkOptions([
  { to: "/campaigns", label: "キャンペーン", icon: GitBranch },
]);

const emailNavigation = linkOptions([
  { to: "/emails", label: "キャンペーン", icon: Send },
  { to: "/emails/templates", label: "テンプレート", icon: FileText },
  { to: "/emails/variables", label: "メッセージ変数", icon: Braces },
  { to: "/emails/archive", label: "アーカイブ", icon: Archive },
]);

const utilityNavigation = linkOptions([
  { to: "/forms", label: "フォーム", icon: FileText },
  { to: "/settings", label: "設定", icon: Settings },
]);

export function AppShell({ workspace }: { workspace: Workspace }): ReactNode {
  const navigate = useNavigate();
  const router = useRouter();

  async function signOut(): Promise<void> {
    await authClient.signOut();
    await router.invalidate({ sync: true });
    await navigate({
      to: "/login",
      search: { redirect: "/dashboard" },
      replace: true,
    });
  }

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
                <PrimaryNavigation items={dashboardNavigation} />
                <ContactNavigation />
                <PrimaryNavigation items={automationNavigation} />
                <NestedNavigation
                  to="/emails"
                  label="メール"
                  icon={Mail}
                  items={emailNavigation}
                />
                <PrimaryNavigation items={utilityNavigation} />
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
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut data-icon="inline-start" />
            ログアウト
          </Button>
        </header>
        <div className="mx-auto w-full max-w-[1500px] p-4 lg:p-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

type NavigationItem = {
  to: string;
  label: string;
  icon: typeof Gauge;
};

function PrimaryNavigation({
  items,
}: {
  items: readonly NavigationItem[];
}): ReactNode {
  return items.map((item) => (
    <SidebarMenuItem key={item.to}>
      <SidebarMenuButton
        render={<Link to={item.to} activeProps={{ "data-active": "true" }} />}
        tooltip={item.label}
      >
        <item.icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  ));
}

function NestedNavigation({
  to,
  label,
  icon: Icon,
  items,
}: NavigationItem & {
  items: readonly NavigationItem[];
}): ReactNode {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to={to} activeProps={{ "data-active": "true" }} />}
        tooltip={label}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
      <SidebarMenuSub>
        {items.map((item) => (
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
  );
}

function ContactNavigation(): ReactNode {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to="/contacts" activeProps={{ "data-active": "true" }} />}
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
  );
}

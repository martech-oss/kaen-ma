import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, linkOptions, useNavigate, useRouter } from "@tanstack/react-router";
import {
  Archive,
  Blocks,
  Braces,
  Building2,
  BriefcaseBusiness,
  ChevronsUpDown,
  ContactRound,
  ChartNoAxesCombined,
  FileText,
  Gauge,
  GitBranch,
  Globe2,
  Images,
  LayoutTemplate,
  LogOut,
  Mail,
  MessageSquareText,
  PanelsTopLeft,
  Send,
  Settings,
  Shapes,
  Tags,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { authClient } from "@/auth-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useSidebar,
} from "@/components/ui/sidebar";

const dashboardNavigation = linkOptions([
  { to: "/dashboard", label: "ダッシュボード", icon: Gauge },
  { to: "/reports", label: "Reporting", icon: ChartNoAxesCombined },
]);

const contactNavigation = linkOptions([
  { to: "/contacts", label: "連絡先", icon: UsersRound },
  { to: "/contacts/companies", label: "会社", icon: Building2 },
  { to: "/contacts/tags", label: "タグ", icon: Tags },
  { to: "/contacts/segments", label: "セグメント", icon: Shapes },
]);

const automationNavigation = linkOptions([
  { to: "/automations", label: "オートメーション", icon: GitBranch },
]);

const dealNavigation = linkOptions([{ to: "/deals", label: "Deals", icon: BriefcaseBusiness }]);

const emailNavigation = linkOptions([
  { to: "/emails", label: "キャンペーン", icon: Send },
  { to: "/emails/templates", label: "テンプレート", icon: FileText },
  { to: "/emails/variables", label: "メッセージ変数", icon: Braces },
  { to: "/emails/archive", label: "アーカイブ", icon: Archive },
]);

const websiteNavigation = linkOptions([
  {
    to: "/website/forms",
    label: "サインアップフォーム",
    icon: LayoutTemplate,
  },
  { to: "/website/pages", label: "ランディングページ", icon: PanelsTopLeft },
  { to: "/website/assets", label: "アセット", icon: Images },
  {
    to: "/website/messages",
    label: "サイトメッセージ",
    icon: MessageSquareText,
  },
  {
    to: "/website/tracking",
    label: "サイトトラッキング",
    icon: ChartNoAxesCombined,
  },
]);

const utilityNavigation = linkOptions([{ to: "/settings", label: "設定", icon: Settings }]);

export function AppShell({ user }: { user: { name: string; email: string } }): ReactNode {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut(): Promise<void> {
    await authClient.signOut();
    queryClient.clear();
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
        className="sr-only z-[100] rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-3 focus:ring-ring/50 focus:outline-none"
      >
        メインコンテンツへ移動
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-1">
              <SidebarMenuButton
                render={<Link to="/dashboard" />}
                size="lg"
                tooltip="Kaenma"
                className="flex-1 group-data-[collapsible=icon]:hidden"
              >
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Blocks />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Kaenma</span>
                </div>
              </SidebarMenuButton>
              <SidebarTrigger className="shrink-0" aria-label="ナビゲーションを開閉" />
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
                <PrimaryNavigation items={dealNavigation} />
                <PrimaryNavigation items={automationNavigation} />
                <NestedNavigation to="/emails" label="メール" icon={Mail} items={emailNavigation} />
                <NestedNavigation
                  to="/website"
                  label="Website"
                  icon={Globe2}
                  items={websiteNavigation}
                />
                <PrimaryNavigation items={utilityNavigation} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <AccountMenu user={user} onSignOut={signOut} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset id="main-content" tabIndex={-1}>
        <div className="p-2 pb-0 md:hidden">
          <SidebarTrigger aria-label="ナビゲーションを開く" />
        </div>
        <div className="mx-auto w-full max-w-[1500px] p-4 lg:p-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AccountMenu({
  user,
  onSignOut,
}: {
  user: { name: string; email: string };
  onSignOut: () => Promise<void>;
}): ReactNode {
  const { isMobile } = useSidebar();
  const displayName = user.name.trim() || user.email;
  const fallback = displayName.charAt(0).toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip="アカウントメニュー"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="size-8">
              <AvatarFallback>{fallback}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>アカウント</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void onSignOut()}>
                <LogOut />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

type NavigationItem = {
  to: string;
  label: string;
  icon: typeof Gauge;
};

function PrimaryNavigation({ items }: { items: readonly NavigationItem[] }): ReactNode {
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

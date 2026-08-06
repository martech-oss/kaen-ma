import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { activeSection, isTabExact, type NavLink } from "@/layouts/navigation";
import { cn } from "@/lib/utils";

/**
 * The app-wide page header: title, the live route path, page actions, and the
 * active section's sub-navigation as a tab row.
 *
 * Tabs default to whatever section owns the current URL rather than being
 * passed in per page, so the row cannot drift from the sidebar — pass `tabs`
 * only for a page needing a row the route table does not describe.
 */
export function PageHeader({
  title,
  action,
  tabs,
}: {
  title: string;
  action?: ReactNode;
  tabs?: readonly NavLink[];
}): ReactNode {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const section = activeSection(pathname);
  const resolvedTabs = tabs ?? section?.tabs ?? [];

  return (
    <header
      className={cn("shrink-0 border-b bg-card px-6 pt-3.5", resolvedTabs.length === 0 && "pb-3.5")}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <SidebarTrigger className="self-center md:hidden" aria-label="ナビゲーションを開く" />
          <h1 className="truncate font-heading text-[19px] leading-tight font-bold">{title}</h1>
          <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
            {pathname}
          </span>
        </div>
        {action}
      </div>
      {resolvedTabs.length > 0 ? (
        <nav className="mt-3 no-scrollbar flex gap-5 overflow-x-auto">
          {resolvedTabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              {...(section && isTabExact(section, tab) ? { activeOptions: { exact: true } } : {})}
              activeProps={{ "data-active": "true" }}
              className="shrink-0 px-px pb-2.5 text-[13px] font-medium text-muted-foreground data-active:text-foreground data-active:shadow-[inset_0_-2px_0_var(--color-primary)]"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

/**
 * Page scaffold: a fixed header over a scrolling content column.
 *
 * `fill` hands the full remaining height to the children instead of letting the
 * column scroll — for list screens whose table body scrolls on its own under a
 * pinned toolbar and pagination footer.
 */
export function PageLayout({
  title,
  action,
  tabs,
  fill = false,
  children,
}: {
  title: string;
  action?: ReactNode;
  tabs?: readonly NavLink[];
  fill?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={title} action={action} {...(tabs === undefined ? {} : { tabs })} />
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 px-6",
          fill ? "min-h-0 overflow-hidden pt-3.5" : "overflow-y-auto py-4.5",
        )}
      >
        {children}
      </div>
    </div>
  );
}

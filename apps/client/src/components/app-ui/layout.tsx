import type { ReactNode } from "react";

export function PageHeader({ title, action }: { title: string; action?: ReactNode }): ReactNode {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">{title}</h1>
      {action}
    </header>
  );
}

export function PageLayout({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} action={action} />
      {children}
    </div>
  );
}

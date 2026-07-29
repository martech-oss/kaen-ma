import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/$")({
  component: NotFoundRoute,
});

function NotFoundRoute() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="text-sm font-medium text-muted-foreground">404</span>
        <h1 className="font-heading text-3xl font-semibold">ページが見つかりません</h1>
        <p className="text-sm text-muted-foreground">
          URLを確認するか、ダッシュボードへ戻ってください。
        </p>
        <Button nativeButton={false} render={<Link to="/dashboard" />}>
          ダッシュボードへ戻る
        </Button>
      </div>
    </main>
  );
}

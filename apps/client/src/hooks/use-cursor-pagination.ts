import { useEffect, useState } from "react";

/**
 * Local, not URL-synced: the cursor resets whenever `resetKey` changes, which
 * should be the same filters object a paginated list query already refetches
 * on. `hasNextPage`/`onNext` still need the query's own `nextCursor`, since
 * that comes from the server response, not from this hook.
 */
export function useCursorPagination(resetKey: unknown) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  useEffect(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, [resetKey]);

  function goToNextPage(nextCursor: string | undefined): void {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor ?? ""]);
    setCursor(nextCursor);
  }

  function goToPreviousPage(): void {
    setCursorHistory((history) => {
      if (history.length === 0) return history;
      setCursor(history[history.length - 1] || undefined);
      return history.slice(0, -1);
    });
  }

  return { cursor, hasPreviousPage: cursorHistory.length > 0, goToNextPage, goToPreviousPage };
}

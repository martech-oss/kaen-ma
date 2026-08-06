import { useEffect, useRef } from "react";

/**
 * Calls `onCommit(value)` `delayMs` after `value` last changed - the debounced
 * "stop typing, then navigate" pattern every search filter in this app needs.
 * `value` should be a primitive or a memoized object so its identity only
 * changes when the thing it represents actually does.
 */
export function useDebouncedSearch<T>({
  value,
  onCommit,
  delayMs = 180,
}: {
  value: T;
  onCommit: (value: T) => void;
  delayMs?: number;
}): void {
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const timer = window.setTimeout(() => onCommitRef.current(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
}

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { ContactSearch, ContactStatus } from "@/features/contacts/contact-api";

/** How long typing settles before the filters are pushed into the URL. */
const NAVIGATE_DEBOUNCE_MS = 180;

/**
 * Mirrors the contact list filters between local state and the URL search params.
 *
 * The list is driven by the URL (the route loader reads it), but the inputs need
 * to stay responsive while typing, so each filter is held in local state and
 * flushed to the URL after a pause. Navigation uses `replace` so filtering does
 * not fill the history stack.
 */
export function useContactFilters(initialSearch: ContactSearch) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialSearch.q);
  const [status, setStatus] = useState<ContactStatus>(initialSearch.status);
  const [stage, setStage] = useState(initialSearch.stage);
  const [tagId, setTagId] = useState(initialSearch.tagId);
  const [accountId, setAccountId] = useState(initialSearch.accountId);
  const [segmentId, setSegmentId] = useState(initialSearch.segmentId);
  const [scoreMin, setScoreMin] = useState(initialSearch.scoreMin);
  const [scoreMax, setScoreMax] = useState(initialSearch.scoreMax);
  const [sort, setSort] = useState(initialSearch.sort);
  const [direction, setDirection] = useState(initialSearch.direction);

  // Adopt filters that changed outside these inputs (back/forward, a saved segment link).
  useEffect(() => {
    setQuery(initialSearch.q);
    setStatus(initialSearch.status);
    setStage(initialSearch.stage);
    setTagId(initialSearch.tagId);
    setAccountId(initialSearch.accountId);
    setSegmentId(initialSearch.segmentId);
    setScoreMin(initialSearch.scoreMin);
    setScoreMax(initialSearch.scoreMax);
    setSort(initialSearch.sort);
    setDirection(initialSearch.direction);
  }, [initialSearch]);

  useEffect(() => {
    const nextSearch: ContactSearch = {
      q: query,
      status,
      stage,
      tagId,
      accountId,
      segmentId,
      scoreMin,
      scoreMax,
      sort,
      direction: direction === "asc" ? "asc" : "desc",
    };
    // Bail out when nothing actually changed, or adopting the URL above would
    // immediately navigate back to it.
    if (
      Object.keys(nextSearch).every(
        (key) =>
          nextSearch[key as keyof ContactSearch] === initialSearch[key as keyof ContactSearch],
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/contacts",
        search: nextSearch,
        replace: true,
      });
    }, NAVIGATE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    accountId,
    direction,
    initialSearch,
    navigate,
    query,
    scoreMax,
    scoreMin,
    segmentId,
    sort,
    stage,
    status,
    tagId,
  ]);

  const hasAdvancedFilters = Boolean(
    stage || tagId || accountId || segmentId || scoreMin || scoreMax,
  );

  /** Resets everything except `status`, which has its own control outside the filter panel. */
  function clearFilters() {
    setQuery("");
    setStage("");
    setTagId("");
    setAccountId("");
    setSegmentId("");
    setScoreMin("");
    setScoreMax("");
    setSort("updatedAt");
    setDirection("desc");
  }

  return {
    query,
    setQuery,
    status,
    setStatus,
    stage,
    setStage,
    tagId,
    setTagId,
    accountId,
    setAccountId,
    segmentId,
    setSegmentId,
    scoreMin,
    setScoreMin,
    scoreMax,
    setScoreMax,
    sort,
    setSort,
    direction,
    setDirection,
    hasAdvancedFilters,
    clearFilters,
  };
}

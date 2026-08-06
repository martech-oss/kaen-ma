import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import type { ContactSearch, ContactStatus } from "@/features/contacts/contact-api";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";

/**
 * Mirrors the contact list filters between local state and the URL search params.
 *
 * The list is driven by the URL (the route loader reads it), but the inputs need
 * to stay responsive while typing, so each filter is held in local state and
 * flushed to the URL after a pause. Navigation uses `replace` so filtering does
 * not fill the history stack.
 */
export type ContactFilters = ReturnType<typeof useContactFilters>;

export function useContactFilters(initialSearch: ContactSearch) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialSearch.q);
  const [status, setStatus] = useState<ContactStatus>(initialSearch.status);
  const [stage, setStage] = useState(initialSearch.stage);
  const [tagId, setTagId] = useState(initialSearch.tagId);
  const [companyId, setCompanyId] = useState(initialSearch.companyId);
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
    setCompanyId(initialSearch.companyId);
    setSegmentId(initialSearch.segmentId);
    setScoreMin(initialSearch.scoreMin);
    setScoreMax(initialSearch.scoreMax);
    setSort(initialSearch.sort);
    setDirection(initialSearch.direction);
  }, [initialSearch]);

  const nextSearch = useMemo<ContactSearch>(
    () => ({
      q: query,
      status,
      stage,
      tagId,
      companyId,
      segmentId,
      scoreMin,
      scoreMax,
      sort,
      direction: direction === "asc" ? "asc" : "desc",
    }),
    [companyId, direction, query, scoreMax, scoreMin, segmentId, sort, stage, status, tagId],
  );

  useDebouncedSearch({
    value: nextSearch,
    onCommit: (value) => {
      // Bail out when nothing actually changed, or adopting the URL above would
      // immediately navigate back to it.
      const unchanged = Object.keys(value).every(
        (key) => value[key as keyof ContactSearch] === initialSearch[key as keyof ContactSearch],
      );
      if (unchanged) return;
      void navigate({ to: "/contacts", search: value, replace: true });
    },
  });

  const hasAdvancedFilters = Boolean(
    stage || tagId || companyId || segmentId || scoreMin || scoreMax,
  );

  /** Resets everything except `status`, which has its own control outside the filter panel. */
  function clearFilters() {
    setQuery("");
    setStage("");
    setTagId("");
    setCompanyId("");
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
    companyId,
    setCompanyId,
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

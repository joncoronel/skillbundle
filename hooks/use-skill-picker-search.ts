"use client";

import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { searchSkills, type SkillSearchResult } from "@/lib/search/typesense";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-params";

// The pickers show a flat, non-paginated list — one page, capped here. Deep
// results past this are reachable by typing a tighter query.
const PICKER_RESULTS = 50;

/**
 * Query options for the picker's skill search, shared between the sheet-level
 * hook (spinner state) and `PickerSearchResults` (data) so both subscribe to
 * the same cache entry and the search runs once.
 *
 * Names-only relevance search with forks/copies hidden — parity with the old
 * Convex `searchSkills` (delisted skills never enter the Typesense index).
 */
export function skillPickerSearchOptions(query: string) {
  return {
    queryKey: ["skill-picker-search", query] as const,
    queryFn: (): Promise<SkillSearchResult> =>
      searchSkills({
        query,
        filters: { hideForks: true },
        perPage: PICKER_RESULTS,
      }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  };
}

/**
 * Debounced Typesense search for the skill pickers (bundle edit, compare).
 * Same input contract as `useDebouncedCachedSearch` (which stays Convex-bound
 * for the /explore bundle search):
 *
 * - Debounce the raw input so the engine isn't hit on every keystroke.
 * - Synchronous cache bypass: a trimmed input that's already cached skips the
 *   debounce for instant results.
 * - Render-time reset on clear so a fast retype never sees the previous
 *   query leak through.
 * - `isInputLoading` synchronously covers the debounce → fetch gap so the
 *   input icon doesn't flash back to the search glyph mid-typing.
 */
export function useSkillPickerSearch(rawQuery: string): {
  effectiveQuery: string;
  isInputLoading: boolean;
} {
  const trimmed = rawQuery.trim();

  const [debounced, setDebounced] = useState(trimmed);
  if (!trimmed && debounced) {
    setDebounced("");
  }
  useEffect(() => {
    if (!trimmed) return;
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const queryClient = useQueryClient();
  const isCached = trimmed
    ? queryClient.getQueryData(skillPickerSearchOptions(trimmed).queryKey) !==
      undefined
    : false;

  const effectiveQuery = trimmed ? (isCached ? trimmed : debounced) : "";

  const queryResult = useQuery({
    ...skillPickerSearchOptions(effectiveQuery),
    enabled: effectiveQuery.length > 0,
    placeholderData: keepPreviousData,
  });

  const isInputLoading =
    trimmed.length > 0 &&
    !isCached &&
    (trimmed !== effectiveQuery ||
      queryResult.isFetching ||
      queryResult.isPlaceholderData);

  return { effectiveQuery, isInputLoading };
}

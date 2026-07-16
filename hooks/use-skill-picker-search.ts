"use client";

import { useQuery } from "@tanstack/react-query";
import { searchSkills, type SkillSearchResult } from "@/lib/search/typesense";
import {
  deriveInputLoading,
  useDebouncedQueryValue,
  SEARCH_RESULT_CACHE,
} from "@/hooks/use-debounced-query-value";

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
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<SkillSearchResult> =>
      searchSkills({
        query,
        filters: { hideForks: true },
        perPage: PICKER_RESULTS,
        signal,
      }),
    ...SEARCH_RESULT_CACHE,
  };
}

/**
 * Debounced Typesense search for the skill pickers (bundle edit, compare).
 * The debounce + cache-bypass machinery is the shared
 * `useDebouncedQueryValue` primitive; this hook adds the picker's query
 * wiring and the derived spinner state (`isInputLoading` synchronously covers
 * the debounce → fetch gap so the input icon doesn't flash back to the search
 * glyph mid-typing).
 */
export function useSkillPickerSearch(rawQuery: string): {
  effectiveQuery: string;
  isInputLoading: boolean;
} {
  const trimmed = rawQuery.trim();
  const effectiveQuery = useDebouncedQueryValue(
    rawQuery,
    (t) => skillPickerSearchOptions(t).queryKey,
  );

  const queryResult = useQuery({
    ...skillPickerSearchOptions(effectiveQuery),
    enabled: effectiveQuery.length > 0,
  });

  return {
    effectiveQuery,
    isInputLoading: deriveInputLoading(trimmed, effectiveQuery, queryResult),
  };
}

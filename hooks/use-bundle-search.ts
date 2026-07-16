"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import {
  deriveInputLoading,
  useDebouncedQueryValue,
  SEARCH_RESULT_CACHE,
} from "@/hooks/use-debounced-query-value";

/**
 * Debounced Convex search for /explore's public-bundle search — the one
 * search input NOT backed by Typesense (bundles aren't in the index; skill
 * searches use `useSkillPickerSearch` / `useCatalogSearch`). The debounce +
 * cache-bypass machinery is the shared `useDebouncedQueryValue` primitive;
 * this hook adds the convexQuery wiring and the shared spinner derivation.
 *
 * The underlying TanStack Query result is passed through unchanged so the
 * caller controls its own re-render contract (ExploreContent reads `data` /
 * `isPlaceholderData` for its crossfade state machine).
 */
export function useBundleSearch(rawQuery: string) {
  const trimmed = rawQuery.trim();
  const effectiveQuery = useDebouncedQueryValue(
    rawQuery,
    (t) => convexQuery(api.bundles.searchPublic, { query: t }).queryKey,
  );

  const queryResult = useQuery({
    ...convexQuery(
      api.bundles.searchPublic,
      effectiveQuery ? { query: effectiveQuery } : "skip",
    ),
    ...SEARCH_RESULT_CACHE,
  });

  return {
    effectiveQuery,
    isInputLoading: deriveInputLoading(trimmed, effectiveQuery, queryResult),
    queryResult,
  };
}

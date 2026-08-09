"use client";

import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-params";

/**
 * Shared React Query cache policy for search RESULT SETS — the catalog
 * (useInfiniteQuery) and the skill pickers. One place
 * so the three don't drift: keepPreviousData holds the prior rows while a
 * refinement fetches (no empty flash), 60s stale keeps a session snappy without
 * refetch churn, 5min gc survives a cleared-then-retyped search. (The publisher
 * facet list keeps its own longer staleness — it's a slow-changing count list,
 * not a result set — see publisher-select.tsx.)
 */
export const SEARCH_RESULT_CACHE = {
  placeholderData: keepPreviousData,
  staleTime: 60_000,
  gcTime: 5 * 60_000,
} as const;

/**
 * The one debounce + cache-bypass state machine behind every search input
 * (home catalog, the compare/bundle pickers). Returns the
 * "effective" query the caller should actually fetch with:
 *
 * - **Debounce:** the returned value trails the raw input by
 *   SEARCH_DEBOUNCE_MS so mid-word keystrokes don't fire fetches.
 * - **Synchronous cache bypass:** if the trimmed input's results are already
 *   cached (per `getCacheKey`), the debounce is skipped and the trimmed input
 *   is returned immediately — retyping a recent query swaps results instantly,
 *   with no pending dim and no spinner.
 * - **Render-time reset on clear:** clearing the input resets the debounced
 *   value in the same render, so a fast retype never sees the previous query
 *   leak through.
 *
 * Callers derive their loading UI from `raw.trim() !== effective` plus their
 * own query state — never from timers (see the derived-loading-state rule).
 */
export function useDebouncedQueryValue(
  rawQuery: string,
  /** Build the React Query key under which `trimmed`'s results would live. */
  getCacheKey: (trimmed: string) => QueryKey,
): string {
  const trimmed = rawQuery.trim();

  const [debounced, setDebounced] = useState(trimmed);
  if (!trimmed && debounced) setDebounced("");
  useEffect(() => {
    if (!trimmed) return;
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const queryClient = useQueryClient();
  const isCached =
    trimmed !== debounced &&
    trimmed.length > 0 &&
    queryClient.getQueryData(getCacheKey(trimmed)) !== undefined;

  return trimmed ? (isCached ? trimmed : debounced) : "";
}

/**
 * The spinner derivation paired with useDebouncedQueryValue — shared by every
 * search input so the invariant lives in ONE place: loading is true while
 * search work is outstanding for what's typed (debounce running, fetch in
 * flight, or placeholder rows showing), and false the moment the trimmed
 * input's own results are on screen — a background revalidation must never
 * spin over real results (the derived-loading-state rule).
 */
export function deriveInputLoading(
  trimmed: string,
  effectiveQuery: string,
  queryResult: {
    data: unknown;
    isFetching: boolean;
    isPlaceholderData: boolean;
  },
): boolean {
  // Real results for what's typed are already showing (even if a background
  // revalidation is in flight) — never spin over them.
  const showingTrimmedData =
    trimmed === effectiveQuery &&
    queryResult.data !== undefined &&
    !queryResult.isPlaceholderData;

  return (
    trimmed.length > 0 &&
    !showingTrimmedData &&
    (trimmed !== effectiveQuery ||
      queryResult.isFetching ||
      queryResult.isPlaceholderData)
  );
}

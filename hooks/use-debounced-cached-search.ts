"use client";

import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-params";

type SearchQueryFn = FunctionReference<"query", "public", { query: string }>;

interface UseDebouncedCachedSearchOptions<Fn extends SearchQueryFn> {
  rawQuery: string;
  fn: Fn;
}

interface UseDebouncedCachedSearchResult<Fn extends SearchQueryFn> {
  /**
   * The query value to pass to downstream consumers. Either equal to the
   * current trimmed input (when it's already cached) or the debounced value
   * (otherwise). Empty string means "no search".
   */
  effectiveQuery: string;
  /**
   * True whenever there's pending search work for the current trimmed input
   * — debounce hasn't caught up, fetch is in flight, or we're showing
   * placeholder data for a previous query. False when the trimmed input is
   * cached (results already showing) or empty.
   */
  isInputLoading: boolean;
  /**
   * The underlying TanStack Query result, passed through unchanged so each
   * caller's Proxy tracking is determined by what *they* read. Callers that
   * only need spinner state should ignore this field; callers that render
   * `data` should destructure it here.
   */
  queryResult: UseQueryResult<FunctionReturnType<Fn>>;
}

/**
 * Shared search-input machinery for the home page and /explore:
 *
 * - **Debounce** the raw input so the backend isn't hit on every keystroke.
 * - **Synchronous cache bypass:** if the trimmed input is already cached,
 *   skip the debounce and use it directly for instant results.
 * - **Render-time reset on clear:** when the input is cleared, the debounced
 *   value is reset in the same render so a fast retype doesn't see the
 *   previous query leak through.
 * - **Spinner state (`isInputLoading`)** synchronously covers the gap
 *   between debounce-fired and fetch-initiated (via `isPlaceholderData`),
 *   so the input icon doesn't flash back to the search glyph mid-typing.
 *
 * The underlying TanStack Query result is passed through unchanged so
 * callers control their own re-render contract: a parent that only needs
 * spinner state (e.g. `<SkillExplorer>` — its child owns data rendering)
 * won't subscribe to data changes, while a data consumer (e.g.
 * `<ExploreContent>`) destructures `query.data` and tracks it normally.
 */
export function useDebouncedCachedSearch<Fn extends SearchQueryFn>({
  rawQuery,
  fn,
}: UseDebouncedCachedSearchOptions<Fn>): UseDebouncedCachedSearchResult<Fn> {
  // Cast to the base constraint locally so convexQuery's conditional arg
  // types can resolve (TS can't simplify `ConvexQueryArgsOrSkip<Fn>` while
  // Fn is still a generic). The Fn generic is preserved at the return-type
  // boundary so callers keep their data-typing.
  //
  // Trip-wire: structural subtyping means a future search-style query with
  // *extra required args* (e.g. `{ query: string; cursor: string }`) would
  // still satisfy `Fn extends SearchQueryFn` and pass this cast — but would
  // runtime-error inside convexQuery because we only ever pass
  // `{ query: ... }`. Both current callers are exactly `{ query: string }`;
  // if that changes, swap the cast for an `argsFor: (q: string) =>
  // FunctionArgs<Fn>` callback prop so TS enforces the args shape per call.
  const fnBase = fn as SearchQueryFn;

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
  // Rebuilt every render — convexQuery's allocation is cheap (one object +
  // a 3-element key array) and getQueryData hashes the key for lookup, so a
  // useMemo here would cost more in deps-comparison bookkeeping than it
  // saves. Documented to head off future "wait, should this be memoized?"
  // re-debates.
  const cachedKey = trimmed
    ? convexQuery(fnBase, { query: trimmed }).queryKey
    : null;
  const isCached = cachedKey
    ? queryClient.getQueryData(cachedKey) !== undefined
    : false;

  const effectiveQuery = trimmed ? (isCached ? trimmed : debounced) : "";

  const queryResult = useQuery({
    ...convexQuery(
      fnBase,
      effectiveQuery ? { query: effectiveQuery } : "skip",
    ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  }) as UseQueryResult<FunctionReturnType<Fn>>;

  const isInputLoading =
    trimmed.length > 0 &&
    !isCached &&
    (trimmed !== effectiveQuery ||
      queryResult.isFetching ||
      queryResult.isPlaceholderData);

  return {
    effectiveQuery,
    isInputLoading,
    queryResult,
  };
}

"use client";

import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { useDebouncedQueryValue } from "@/hooks/use-debounced-query-value";

type SearchQueryFn = FunctionReference<"query", "public", { query: string }>;

// Exact-args guard: this hook only ever calls `fn` with `{ query }`, but
// structural subtyping means a query with EXTRA required args (e.g.
// `{ query: string; cursor: string }`) would still satisfy the constraint —
// and runtime-error inside convexQuery. Requiring `{ query: string }` to be
// assignable BACK to the function's args rejects such functions at the call
// site instead.
type ExactSearchQueryFn<Fn extends SearchQueryFn> = {
  query: string;
} extends FunctionArgs<Fn>
  ? Fn
  : never;

interface UseDebouncedCachedSearchOptions<Fn extends SearchQueryFn> {
  rawQuery: string;
  fn: Fn & ExactSearchQueryFn<Fn>;
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
   * placeholder data for a previous query. False when the trimmed input's
   * results are already showing, or the input is empty.
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
 * Debounced Convex search-input wiring — used by /explore's bundle search
 * (bundles aren't in the Typesense index; skill searches use
 * `useSkillPickerSearch` / `useCatalogSearch` instead). The debounce +
 * cache-bypass machinery is the shared `useDebouncedQueryValue` primitive;
 * this hook adds the convexQuery wiring and the derived spinner state.
 *
 * The underlying TanStack Query result is passed through unchanged so
 * callers control their own re-render contract: a parent that only needs
 * spinner state won't subscribe to data changes, while a data consumer
 * (e.g. `<ExploreContent>`) destructures `query.data` and tracks it normally.
 */
export function useDebouncedCachedSearch<Fn extends SearchQueryFn>({
  rawQuery,
  fn,
}: UseDebouncedCachedSearchOptions<Fn>): UseDebouncedCachedSearchResult<Fn> {
  // Cast to the base constraint locally so convexQuery's conditional arg
  // types can resolve (TS can't simplify `ConvexQueryArgsOrSkip<Fn>` while
  // Fn is still a generic). The Fn generic is preserved at the return-type
  // boundary so callers keep their data-typing. Safety is enforced at the
  // boundary: ExactSearchQueryFn rejects functions with extra required args,
  // so this cast can't hide an args mismatch.
  const fnBase = fn as SearchQueryFn;

  const trimmed = rawQuery.trim();
  const effectiveQuery = useDebouncedQueryValue(
    rawQuery,
    (t) => convexQuery(fnBase, { query: t }).queryKey,
  );

  const queryResult = useQuery({
    ...convexQuery(
      fnBase,
      effectiveQuery ? { query: effectiveQuery } : "skip",
    ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  }) as UseQueryResult<FunctionReturnType<Fn>>;

  // Real results for what's typed are already showing (even if a background
  // revalidation is in flight) — never spin over them.
  const showingTrimmedData =
    trimmed === effectiveQuery &&
    queryResult.data !== undefined &&
    !queryResult.isPlaceholderData;

  const isInputLoading =
    trimmed.length > 0 &&
    !showingTrimmedData &&
    (trimmed !== effectiveQuery ||
      queryResult.isFetching ||
      queryResult.isPlaceholderData);

  return {
    effectiveQuery,
    isInputLoading,
    queryResult,
  };
}

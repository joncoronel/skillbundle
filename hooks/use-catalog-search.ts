"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  searchSkills,
  type FacetCount,
  type SkillFilters,
  type SkillHit,
  type SkillSearchResult,
  type SkillSort,
} from "@/lib/search/typesense";
import { SEARCH_RESULT_CACHE } from "@/hooks/use-debounced-query-value";

const PER_PAGE = 30;

/**
 * The React Query key for one catalog search state. Exported so components
 * above the hook (SkillExplorer's status derivation, the input spinner) can
 * make the same synchronous cache checks the hook makes, without duplicating
 * the key/filters encoding.
 */
export function catalogSearchQueryKey(
  query: string,
  sort: SkillSort,
  filters: SkillFilters,
  searchDescriptions: boolean,
) {
  // In browse mode (empty query) searchDescriptions can't change results —
  // there's no query to match names-vs-descriptions against — so collapse it to
  // false. Otherwise toggling the scope mid-browse would refetch an identical
  // set and dim the rows for nothing.
  const scope = query === "" ? false : searchDescriptions;
  // The filters object goes in the key as-is: React Query hashes plain objects
  // structurally (sorted keys, undefined dropped), so a new SkillFilters field
  // is automatically part of the key — no hand-maintained encoding to forget.
  return ["typesense-catalog", query, sort, filters, scope] as const;
}

interface UseCatalogSearchOptions {
  /**
   * The EFFECTIVE query — already trimmed, debounced, and cache-bypassed by
   * the caller (useDebouncedQueryValue in SkillExplorer). "" = browse.
   */
  query: string;
  sort: SkillSort;
  filters: SkillFilters;
  /** Also match on description (default: names only). */
  searchDescriptions: boolean;
}

/**
 * The active-state catalog query: text search + filters + sort against
 * Typesense (browser-direct), with page-based infinite scroll and facet
 * counts from the first page.
 *
 * IMPORTANT: useInfiniteQuery's observer reads Date.now() during render, so
 * this hook must only run in components mounted AFTER hydration — i.e. inside
 * the active state, never in the statically-prerendered entry state (same
 * constraint as PopularList's useHydrated gate in default-skills-list.tsx).
 * The debounce lives with the caller (useDebouncedQueryValue) so the parent
 * can derive spinner/settled state from the same cache keys — see
 * useCatalogSearchStatus below.
 */
export function useCatalogSearch({
  query: effectiveQuery,
  sort,
  filters,
  searchDescriptions,
}: UseCatalogSearchOptions) {
  const query = useInfiniteQuery({
    queryKey: catalogSearchQueryKey(
      effectiveQuery,
      sort,
      filters,
      searchDescriptions,
    ),
    queryFn: ({ pageParam, signal }) =>
      searchSkills({
        query: effectiveQuery,
        sort,
        filters,
        // Match the key's browse-mode collapse (catalogSearchQueryKey): with
        // no query, query_by is ignored, so the request visibly agrees with the
        // cache key instead of carrying a value that can't affect results.
        searchDescriptions: effectiveQuery ? searchDescriptions : false,
        page: pageParam,
        perPage: PER_PAGE,
        // Facet counts only change with query/filters, not page — fetch once.
        facets: pageParam === 1,
        signal,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * PER_PAGE < last.found ? last.page + 1 : undefined,
    // Keep the previous result set mounted while a refinement fetches (so
    // typing "auth" → "authe" dims the old rows instead of flashing empty),
    // plus the shared stale/gc policy.
    ...SEARCH_RESULT_CACHE,
  });

  const hits: SkillHit[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.hits),
    [query.data?.pages],
  );

  const firstPage = query.data?.pages[0];

  return {
    hits,
    found: firstPage?.found ?? 0,
    /** Showing a PREVIOUS state's rows while this key fetches (keepPreviousData)
     *  — drives the loading dim. Deliberately NOT `isFetching`: a background
     *  revalidation of the current key (window refocus after staleTime) must
     *  never dim already-correct rows — the house derived-loading rule. Cold
     *  fetches are covered by `isInitialLoading`, pagination by
     *  `isFetchingNextPage`. (The debounce gap is the caller's to add:
     *  `trimmed !== effectiveQuery`.) */
    isPending: query.isPlaceholderData,
    /** No data at all yet (first ever fetch for this state). */
    isInitialLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

const EMPTY_FACETS: Record<string, FacetCount[]> = {};

interface UseCatalogSearchStatusOptions {
  /** The current trimmed input — the search's DESTINATION state. */
  trimmedQuery: string;
  /** The effective (debounced / cache-bypassed) query actually being fetched. */
  effectiveQuery: string;
  sort: SkillSort;
  filters: SkillFilters;
  searchDescriptions: boolean;
  /** Whether the Typesense results view is mounted at all. */
  active: boolean;
}

type CatalogData = InfiniteData<SkillSearchResult>;

/**
 * Parent-side search status, DERIVED from the shared React Query cache — no
 * report-up callbacks, no effect mirrors. ActiveCatalogResults fetches under
 * `catalogSearchQueryKey(effectiveQuery, ...)`; this hook subscribes to the
 * query cache (useSyncExternalStore) and reads the same entries:
 *
 * - `pending` — search work is outstanding for what the user typed: the
 *   destination entry doesn't exist yet (debounce running) or has no data
 *   (fetch in flight). Cached retypes are never pending. Drives the input
 *   spinner.
 * - `settled` — the results view has something to render (data for the
 *   effective key, or — via keepPreviousData — anything earlier in this
 *   active session). Until then the parent keeps the Popular list up, dimmed,
 *   as filler. Session-scoped state, adjusted during render (the React
 *   "adjusting state when props change" pattern — no effects).
 * - `facets` — the effective entry's first-page facet counts, held across
 *   refinements (matching the rows, which keepPreviousData also holds).
 */
export function useCatalogSearchStatus({
  trimmedQuery,
  effectiveQuery,
  sort,
  filters,
  searchDescriptions,
  active,
}: UseCatalogSearchStatusOptions) {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  // queueMicrotask is load-bearing: TanStack builds cache entries DURING other
  // components' renders (a cold useQuery adds its entry at render and the
  // cache notifies synchronously), so a raw subscribe would setState here
  // while another component renders — React's "cannot update a component
  // while rendering a different component" error. Deferring the notification
  // a microtask loses nothing: useSyncExternalStore re-reads the snapshot
  // when it lands, so it always sees the final cache state.
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      cache.subscribe((event) => {
        // Only catalog-search entries can change our snapshots — skip the
        // app-wide churn (every Convex query event otherwise lands here and
        // forces a snapshot re-read).
        if (event.query.queryKey[0] !== "typesense-catalog") return;
        queueMicrotask(onStoreChange);
      }),
    [cache],
  );

  const trimmedKey = catalogSearchQueryKey(
    trimmedQuery,
    sort,
    filters,
    searchDescriptions,
  );
  const effectiveKey = catalogSearchQueryKey(
    effectiveQuery,
    sort,
    filters,
    searchDescriptions,
  );

  // Is work outstanding for the destination (trimmed) state? No entry =
  // debounce hasn't fired the fetch yet; entry without data = in flight.
  // An errored entry is NOT pending — the error card owns that state.
  const pending = useSyncExternalStore(
    subscribe,
    () => {
      if (!active || trimmedQuery.length === 0) return false;
      const state = queryClient.getQueryState(trimmedKey);
      if (!state) return true;
      if (state.data !== undefined) return false;
      return state.status === "pending";
    },
    () => false,
  );

  // First-page facets for the effective entry. The snapshot returns the cached
  // object itself (structurally shared by React Query), so the reference is
  // stable until the entry's data actually changes.
  const effectiveFacets = useSyncExternalStore(
    subscribe,
    () =>
      active
        ? queryClient.getQueryData<CatalogData>(effectiveKey)?.pages[0]?.facets
        : undefined,
    () => undefined,
  );
  const hasEffectiveData = effectiveFacets !== undefined;

  // Session-scoped "has rendered results at least once": keepPreviousData
  // means the results view keeps earlier rows through refinements, so once
  // settled it stays settled until search deactivates (view unmounts).
  const [sessionSettled, setSessionSettled] = useState(false);
  if (active && hasEffectiveData && !sessionSettled) setSessionSettled(true);
  if (!active && sessionSettled) setSessionSettled(false);

  // Hold the last real facets across refinements (the entry for a new
  // effective key has none until its fetch lands).
  const [heldFacets, setHeldFacets] = useState(EMPTY_FACETS);
  if (active && effectiveFacets && effectiveFacets !== heldFacets) {
    setHeldFacets(effectiveFacets);
  }
  if (!active && heldFacets !== EMPTY_FACETS) setHeldFacets(EMPTY_FACETS);

  return {
    pending,
    settled: active && (sessionSettled || hasEffectiveData),
    facets: heldFacets,
  };
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
} from "@tanstack/react-query";
import {
  searchSkills,
  type FacetCount,
  type SkillFilters,
  type SkillHit,
  type SkillSort,
} from "@/lib/search/typesense";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-params";

const PER_PAGE = 30;

interface UseCatalogSearchOptions {
  /** Raw (untrimmed) query. Debounced internally; "" = browse the catalog. */
  rawQuery: string;
  sort: SkillSort;
  filters: SkillFilters;
  /** Also match on description (default: names only). */
  searchDescriptions: boolean;
}

/**
 * The active-state catalog query: debounced text search + filters + sort
 * against Typesense (browser-direct), with page-based infinite scroll and
 * facet counts from the first page.
 *
 * IMPORTANT: useInfiniteQuery's observer reads Date.now() during render, so
 * this hook must only run in components mounted AFTER hydration — i.e. inside
 * the active state, never in the statically-prerendered entry state (same
 * constraint as PopularList's useHydrated gate in default-skills-list.tsx).
 */
export function useCatalogSearch({
  rawQuery,
  sort,
  filters,
  searchDescriptions,
}: UseCatalogSearchOptions) {
  const trimmed = rawQuery.trim();

  // Same debounce contract as use-debounced-cached-search: reset synchronously
  // on clear so a fast retype never sees the previous query leak through.
  const [debounced, setDebounced] = useState(trimmed);
  if (!trimmed && debounced) setDebounced("");
  useEffect(() => {
    if (!trimmed) return;
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  // Stable key for the filters object (fixed key order via explicit fields).
  const filtersKey = `${filters.officialOnly ? 1 : 0}|${filters.audit ?? ""}|${
    filters.hideForks ? 1 : 0
  }|${filters.excludeBroken ? 1 : 0}|${filters.minInstalls ?? ""}|${
    filters.source ?? ""
  }|${(filters.owners ?? []).join(",")}`;

  const query = useInfiniteQuery({
    queryKey: [
      "typesense-catalog",
      debounced,
      sort,
      filtersKey,
      searchDescriptions,
    ] as const,
    queryFn: ({ pageParam }) =>
      searchSkills({
        query: debounced,
        sort,
        filters,
        searchDescriptions,
        page: pageParam,
        perPage: PER_PAGE,
        // Facet counts only change with query/filters, not page — fetch once.
        facets: pageParam === 1,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * PER_PAGE < last.found ? last.page + 1 : undefined,
    // Keep the previous result set mounted while a refinement fetches, so
    // typing "auth" → "authe" dims the old rows instead of flashing empty.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const hits: SkillHit[] = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.hits),
    [query.data?.pages],
  );

  const firstPage = query.data?.pages[0];
  const facets: Record<string, FacetCount[]> = firstPage?.facets ?? {};

  return {
    hits,
    found: firstPage?.found ?? 0,
    facets,
    /** Waiting on the debounce, the fetch, or placeholder data — the "search
     *  work pending" signal that drives the loading dim. */
    isPending:
      (trimmed.length > 0 && trimmed !== debounced) ||
      query.isPlaceholderData ||
      (query.isFetching && !query.isFetchingNextPage),
    /** No data at all yet (first ever fetch for this state). */
    isInitialLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    debouncedQuery: debounced,
  };
}

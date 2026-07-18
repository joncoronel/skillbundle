"use client";

import type { SkillFilters, SkillSort } from "@/lib/search/typesense";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";
import { useExplorerState } from "@/components/explorer-state";
import {
  EmptyState,
  LoadingMoreFooter,
  SkillRowGrid,
} from "@/components/default-skills-list";
import { Button } from "@/components/ui/cubby-ui/button";
import { cn } from "@/lib/utils";

interface ActiveCatalogResultsProps {
  /**
   * The EFFECTIVE query — already trimmed/debounced/cache-bypassed by
   * SkillExplorer (useDebouncedQueryValue), so the parent can derive spinner
   * and settled state from the same cache keys this component fetches under
   * (useCatalogSearchStatus). "" = browse with filters.
   */
  query: string;
  /** The raw input is ahead of `query` (debounce running) — dim the rows. */
  stale: boolean;
  sort: SkillSort;
  filters: SkillFilters;
  /** Also match on description (default: names only). */
  searchDescriptions: boolean;
  /** An actual narrowing filter is set (not just an explicit sort) — gates
   *  the "loosen a filter" hint so it never shows with zero filters. */
  hasNarrowing: boolean;
}

/**
 * The active-state catalog: Typesense-backed results for the current
 * query/sort/filter combination, with page-based infinite scroll.
 *
 * Purely presentational over the shared query cache — the parent derives its
 * status (input spinner, Popular-list handoff, facet counts) from the same
 * cache entries via useCatalogSearchStatus, so nothing is reported up.
 *
 * Mounted ONLY while the home page is in its active state — never during the
 * static prerender — because useCatalogSearch's useInfiniteQuery reads
 * Date.now() during render (same constraint as PopularList).
 */
export function ActiveCatalogResults({
  query,
  stale,
  sort,
  filters,
  searchDescriptions,
  hasNarrowing,
}: ActiveCatalogResultsProps) {
  const {
    hits,
    found,
    hiddenByFilters,
    isPending,
    isInitialLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCatalogSearch({ query, sort, filters, searchDescriptions });

  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  if (error) {
    return (
      <EmptyState message="Search is unavailable right now.">
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => refetch()}
        >
          Try again
        </Button>
      </EmptyState>
    );
  }

  // Cold first fetch: render nothing — SkillExplorer keeps the Popular list up
  // (dimmed) as filler until we're settled, so there's no empty-spinner flash.
  if (isInitialLoading) return null;

  return (
    <div
      className={cn(
        // `starting:opacity-0` fades the results in on the handoff from the
        // (dimming-out) Popular list; `opacity-55` dims them while stale
        // (debounce running) or during a warm refinement fetch.
        "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none starting:opacity-0",
        (stale || isPending) && "opacity-55",
      )}
    >
      {hiddenByFilters !== undefined ? (
        // The query is a real word in the catalog but the narrowing filters
        // hid every exact match — whatever the engine returned in that state
        // is typo fallback ("hero" + Official → "zero" skills), not matches.
        // Render the honest empty state INSTEAD of the hits, mirroring the
        // repo-match screen's Official empty state with the advice upgraded
        // to a one-click action.
        <NarrowedToEmptyState
          query={query}
          count={hiddenByFilters}
          filters={filters}
        />
      ) : hits.length === 0 ? (
        <EmptyState
          message={
            query
              ? `No skills found for “${query}”`
              : "No skills match these filters."
          }
        >
          {hasNarrowing && query && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Try loosening a filter.
            </span>
          )}
        </EmptyState>
      ) : (
        <>
          {/* role=status: count changes announce as the query/filters narrow,
              so screen readers hear the search working. */}
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground mb-3 tabular-nums"
          >
            {found.toLocaleString()} result{found !== 1 && "s"}
          </p>
          {/* SkillHit is structurally a SkillData (plus engine fields) — rows
              render hits directly, no mapping layer. */}
          <SkillRowGrid skills={hits} />
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          {isFetchingNextPage && <LoadingMoreFooter noun="results" />}
        </>
      )}
    </div>
  );
}

/**
 * Filtered-to-empty state: names the filter that emptied the results when
 * Official is the sole narrowing filter (the common toggle case), stays
 * generic otherwise, and offers the way out as one click. clearSheetFilters
 * resets exactly the narrowing set (Official included) — the set that hid
 * the matches — leaving query/sort/scope alone, so the revealed count
 * matches what the probe counted.
 */
function NarrowedToEmptyState({
  query,
  count,
  filters,
}: {
  query: string;
  count: number;
  filters: SkillFilters;
}) {
  const { clearSheetFilters } = useExplorerState();
  const officialIsOnlyFilter =
    Boolean(filters.officialOnly) &&
    !filters.audit &&
    filters.minInstalls === undefined &&
    !filters.excludeBroken &&
    !filters.source &&
    !(filters.owners && filters.owners.length > 0);
  return (
    <EmptyState
      message={
        officialIsOnlyFilter
          ? `No official skills match “${query}”`
          : `No skills match “${query}” with these filters`
      }
    >
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={clearSheetFilters}
      >
        {count === 1 ? "Show the match" : `Show all ${count} matches`}
      </Button>
    </EmptyState>
  );
}

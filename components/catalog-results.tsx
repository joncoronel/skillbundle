"use client";

import type {
  HiddenByFilters,
  SkillFilters,
  SkillSort,
} from "@/lib/search/typesense";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";
import { useExplorerState } from "@/components/explorer-state";
import {
  EmptyState,
  LoadingMoreFooter,
  SkillRowGrid,
} from "@/components/default-skills-list";
import { Button } from "@/components/ui/cubby-ui/button";
import { AddSkillDialog } from "@/components/add-skill/add-skill-dialog";
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
 * Presentational over the shared query cache, plus one explorer-context read
 * (the filtered-to-empty state's clear action) — the parent derives its
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
        // `opacity-55` dims the rows while stale (debounce running) or during
        // a warm refinement fetch. Deliberately NO mount fade: the handoff
        // from the (dimming-out) Popular list used to add a second 200ms
        // opacity stage on top of that dim, so one filter click read as
        // dim-out then fade-up. The dim carries information (these rows are
        // stale), the mount fade only re-animated content that was already
        // correct.
        "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none",
        (stale || isPending) && "opacity-55",
      )}
    >
      {hiddenByFilters ? (
        // The query is a real word in the catalog but the narrowing filters
        // hid every exact match — the engine's response in that state is typo
        // fallback ("hero" + Official → "zero" skills), already disowned by
        // searchSkills (hits are empty). Render the honest empty state,
        // mirroring the repo-match screen's Official empty state with the
        // advice upgraded to a one-click action.
        <NarrowedToEmptyState verdict={hiddenByFilters} />
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
          {query && (
            <>
              <span className="mt-3 block text-xs text-muted-foreground">
                Know a skill we&apos;re missing? Add it from skills.sh or
                GitHub.
              </span>
              <AddSkillDialog
                initialInput={/\/|github\.com/i.test(query) ? query : undefined}
                className="mt-2"
              />
            </>
          )}
        </EmptyState>
      ) : (
        <>
          {/* role=status: count changes announce as the query/filters narrow,
              so screen readers hear the search working. */}
          <p
            role="status"
            aria-live="polite"
            className="mb-3 text-xs text-muted-foreground tabular-nums"
          >
            {found.toLocaleString()} result{found !== 1 && "s"}
          </p>
          {/* `aria-busy` while a page is in flight, not a second live region.
              The visible count above is already a `role="status"`, and two
              status regions on one surface read the same event twice. */}
          <div aria-busy={isFetchingNextPage || undefined}>
            {/* SkillHit is structurally a SkillData (plus engine fields) — rows
                render hits directly, no mapping layer. */}
            <SkillRowGrid skills={hits} />
            <div ref={sentinelRef} aria-hidden="true" className="h-px" />
            {isFetchingNextPage && <LoadingMoreFooter noun="results" />}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Filtered-to-empty state: names the filter that emptied the results when
 * Official was the sole narrowing filter (the common toggle case), stays
 * generic otherwise, and offers the way out as one click.
 *
 * The copy comes ONLY from the verdict — a snapshot of the state it was
 * computed for — never from live explorer state: under keepPreviousData a
 * previous key's verdict renders (dimmed) while the URL/filters are already
 * ahead of it, and copy built from live state would describe a filter set
 * the verdict knows nothing about. The ACTION deliberately reads live state
 * instead: clearSheetFilters resets the current narrowing set (Official
 * included — the same set the probes gate on, see activeNarrowingKeys in
 * lib/search/typesense.ts), leaving query/sort/scope alone, so the revealed
 * set matches what the probe counted.
 */
function NarrowedToEmptyState({ verdict }: { verdict: HiddenByFilters }) {
  const { clearSheetFilters } = useExplorerState();
  return (
    <EmptyState
      message={
        verdict.officialOnly
          ? `No official skills match “${verdict.query}”`
          : `No skills match “${verdict.query}” with these filters`
      }
    >
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={clearSheetFilters}
      >
        {verdict.count === 1
          ? "Show the match"
          : `Show all ${verdict.count} matches`}
      </Button>
    </EmptyState>
  );
}

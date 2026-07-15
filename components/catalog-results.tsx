"use client";

import { useEffect, useRef } from "react";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import type { SkillFilters, SkillSort } from "@/lib/search/typesense";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { SkillRowGrid } from "@/components/default-skills-list";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";
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
  anyFilterActive: boolean;
  sheetHandle: SkillDetailHandle;
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
  anyFilterActive,
  sheetHandle,
}: ActiveCatalogResultsProps) {
  const {
    hits,
    found,
    isPending,
    isInitialLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCatalogSearch({ query, sort, filters, searchDescriptions });

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (error) {
    return (
      <div>
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Search is unavailable right now.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Cold first fetch: render nothing — SkillExplorer keeps the Popular list up
  // (dimmed) as filler until we're settled, so there's no empty-spinner flash.
  if (isInitialLoading) return null;

  return (
    <div>
      <div
        className={cn(
          // `starting:opacity-0` fades the results in on the handoff from the
          // (dimming-out) Popular list; `opacity-55` dims them while stale
          // (debounce running) or during a warm refinement fetch.
          "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none starting:opacity-0",
          (stale || isPending) && "opacity-55",
        )}
      >
        {hits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {query
                ? `No skills found for “${query}”`
                : "No skills match these filters."}
              {anyFilterActive && query && (
                <span className="block mt-1 text-xs">
                  Try loosening a filter.
                </span>
              )}
            </p>
          </div>
        ) : (
          <>
            {/* role=status: count changes announce as the query/filters
                narrow, so screen readers hear the search working. */}
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground mb-3 tabular-nums"
            >
              {found.toLocaleString()} result{found !== 1 && "s"}
            </p>
            {/* SkillHit is structurally a SkillData (plus engine fields) —
                rows render hits directly, no mapping layer. */}
            <SkillRowGrid skills={hits} sheetHandle={sheetHandle} />
            <div ref={sentinelRef} aria-hidden="true" className="h-px" />
            {isFetchingNextPage && (
              <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground">
                <DotMatrixComet size="xs" ariaLabel="Loading more results" />
                <span className="text-xs">Loading more…</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

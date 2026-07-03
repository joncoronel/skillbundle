"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import type { SkillData } from "@/components/skill-card";
import type {
  FacetCount,
  SkillFilters,
  SkillHit,
  SkillSort,
} from "@/lib/search/typesense";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { SkillRowGrid } from "@/components/default-skills-list";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";
import { Button } from "@/components/ui/cubby-ui/button";
import { cn } from "@/lib/utils";

// Stable empty-facets reference so the report-up effect doesn't churn when
// there are no facets yet (a fresh `{}` each render would loop).
const EMPTY_FACETS: Record<string, FacetCount[]> = {};

function hitToSkill(h: SkillHit): SkillData {
  return {
    source: h.source,
    skillId: h.skillId,
    name: h.name,
    description: h.description,
    installs: h.installs,
    hasContentFetchError: h.hasContentFetchError,
    curatedOwner: h.curatedOwner,
    worstAuditStatus: h.worstAuditStatus,
    worstAuditRiskLevel: h.worstAuditRiskLevel,
    copyCount: h.copyCount,
  };
}

interface ActiveCatalogResultsProps {
  rawQuery: string;
  sort: SkillSort;
  filters: SkillFilters;
  /** Also match on description (default: names only). */
  searchDescriptions: boolean;
  anyFilterActive: boolean;
  sheetHandle: SkillDetailHandle;
  /** Reports "search work pending" up so the shared search input (which lives
   *  in SkillExplorer, above this component) can show its inline spinner. */
  onLoadingChange?: (loading: boolean) => void;
  /** Reports the current result set's facet counts up to the filter controls
   *  (which live in the sticky bar in SkillExplorer, not here). */
  onFacetsChange?: (facets: Record<string, FacetCount[]>) => void;
  /** Reports "results are ready to show" up. Until this is true the parent
   *  keeps the previous list (the Popular catalog) visible + dimmed as filler,
   *  so a cold search never flashes an empty spinner — the previous content
   *  simply hands off to the results once they land. */
  onSettledChange?: (settled: boolean) => void;
}

/**
 * The active-state catalog: Typesense-backed results for the current
 * query/sort/filter combination, with page-based infinite scroll.
 *
 * Mounted ONLY while the home page is in its active state — never during the
 * static prerender — because useCatalogSearch's useInfiniteQuery reads
 * Date.now() during render (same constraint as PopularList).
 */
export function ActiveCatalogResults({
  rawQuery,
  sort,
  filters,
  searchDescriptions,
  anyFilterActive,
  sheetHandle,
  onLoadingChange,
  onFacetsChange,
  onSettledChange,
}: ActiveCatalogResultsProps) {
  const {
    hits,
    found,
    facets,
    isPending,
    isInitialLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    debouncedQuery,
  } = useCatalogSearch({ rawQuery, sort, filters, searchDescriptions });

  // Mirror the query's pending state up to the input spinner. Reset to false
  // on unmount (leaving the active state) so the icon doesn't stick as a
  // spinner. `isInitialLoading` covers the first fetch; `isPending` covers
  // debounce + refinement.
  const searchPending = isPending || isInitialLoading;
  useEffect(() => {
    onLoadingChange?.(searchPending);
  }, [searchPending, onLoadingChange]);
  useEffect(() => {
    return () => onLoadingChange?.(false);
  }, [onLoadingChange]);

  // Report facet counts up to the filter controls in the sticky bar. `facets`
  // is a stable ref (React Query structural sharing) or the module-level
  // EMPTY_FACETS, so this effect only fires on real change. Reset on unmount so
  // stale counts don't linger on the controls after search clears.
  const reportedFacets =
    Object.keys(facets).length > 0 ? facets : EMPTY_FACETS;
  useEffect(() => {
    onFacetsChange?.(reportedFacets);
  }, [reportedFacets, onFacetsChange]);
  useEffect(() => {
    return () => onFacetsChange?.(EMPTY_FACETS);
  }, [onFacetsChange]);

  // Settled once there's data to show (even 0 results). Before that — the cold
  // first fetch — the parent keeps the Popular list up (dimmed) as filler.
  // keepPreviousData means refinements stay settled (the prior rows carry over),
  // so this is only false on the very first search after mount.
  const settled = !isInitialLoading;
  useEffect(() => {
    onSettledChange?.(settled);
  }, [settled, onSettledChange]);
  useEffect(() => {
    return () => onSettledChange?.(false);
  }, [onSettledChange]);

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

  const skills = useMemo(() => hits.map(hitToSkill), [hits]);

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
          // (dimming-out) Popular list; `opacity-55` dims them during a warm
          // refinement while the next page fetches.
          "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none starting:opacity-0",
          isPending && "opacity-55",
        )}
      >
        {skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {debouncedQuery
                ? `No skills found for “${debouncedQuery}”`
                : "No skills match these filters."}
              {anyFilterActive && debouncedQuery && (
                <span className="block mt-1 text-xs">
                  Try loosening a filter.
                </span>
              )}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3 tabular-nums">
              {found.toLocaleString()} result{found !== 1 && "s"}
            </p>
            <SkillRowGrid skills={skills} sheetHandle={sheetHandle} />
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

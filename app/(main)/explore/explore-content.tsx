"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useQueryState } from "nuqs";
import { useDebounce } from "use-debounce";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { exploreQueryParser } from "@/lib/search-params";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { Button } from "@/components/ui/cubby-ui/button";
import { ExploreFilters } from "@/components/explore/explore-filters";
import { TrendingBundles } from "@/components/explore/trending-bundles";
import { RecentBundles } from "@/components/explore/recent-bundles";
import { BundleCard, BundleCardSkeleton } from "@/components/bundle-card";

export function ExploreContent() {
  const [query, setQuery] = useQueryState("q", exploreQueryParser);
  const [debouncedQuery] = useDebounce(query.trim(), 300);
  // If raw query is empty, bypass debounce and show trending immediately.
  const effectiveQuery = query.trim() ? debouncedQuery : "";
  const isSearching = effectiveQuery.length > 0;

  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <ExploreFilters ref={inputRef} />
      <Crossfade active={isSearching}>
        {/* Browse state */}
        <div className="space-y-14">
          <TrendingBundles />
          <RecentBundles />
        </div>
        {/* Search state */}
        <SearchResults query={effectiveQuery} onClear={() => setQuery(null)} />
      </Crossfade>
    </>
  );
}

function SearchResults({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  const { data: results, isFetching } = useQuery({
    ...convexQuery(api.bundles.searchPublic, query ? { query } : "skip"),
    gcTime: 5 * 60_000,
  });

  const count = results?.length ?? 0;

  return (
    <section>
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
          &ldquo;{query}&rdquo;
          {results && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              · {count}
            </span>
          )}
        </h2>
      </div>
      {isFetching && !results ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <BundleCardSkeleton key={i} hasStats />
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={1.5}
            className="size-8 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No bundles match that search.
          </p>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results?.map((bundle) => (
            <BundleCard
              key={bundle._id}
              name={bundle.name}
              urlId={bundle.urlId}
              skillCount={bundle.skillCount}
              createdAt={bundle.createdAt}
              creatorName={bundle.creatorName}
              creatorImage={bundle.creatorImage}
              viewCount={bundle.viewCount}
              copyCount={bundle.copyCount}
              forkCount={bundle.forkCount}
            />
          ))}
        </div>
      )}
    </section>
  );
}

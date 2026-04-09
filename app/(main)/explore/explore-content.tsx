"use client";

import { useQuery } from "convex/react";
import { useQueryState } from "nuqs";
import type { Preloaded } from "convex/react";
import { api } from "@/convex/_generated/api";
import { exploreQueryParser } from "@/lib/search-params";
import { ExploreFilters } from "@/components/explore/explore-filters";
import { TrendingBundles } from "@/components/explore/trending-bundles";
import { BundleCard } from "@/components/bundle-card";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton";

export function ExploreContent({
  preloadedTrending,
}: {
  preloadedTrending: Preloaded<typeof api.bundleEvents.getTrendingBundles>;
}) {
  const [query] = useQueryState("q", exploreQueryParser);
  const isSearching = query.trim().length > 0;

  return (
    <>
      <ExploreFilters />
      {isSearching ? (
        <SearchResults query={query} />
      ) : (
        <TrendingBundles preloadedBundles={preloadedTrending} />
      )}
    </>
  );
}

function SearchResults({ query }: { query: string }) {
  const results = useQuery(api.bundles.searchPublic, { query });

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Search results
      </h2>
      {!results ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No bundles match &ldquo;{query}&rdquo;
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((bundle, i) => (
            <div
              key={bundle._id}
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-[both]"
              style={{
                animationDelay: `${i * 30}ms`,
                animationDuration: "150ms",
              }}
            >
              <BundleCard
                name={bundle.name}
                urlId={bundle.urlId}
                skillCount={bundle.skillCount}
                createdAt={bundle.createdAt}
                creatorName={bundle.creatorName}
                viewCount={bundle.viewCount}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

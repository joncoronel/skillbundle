"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { useQueryState } from "nuqs";
import { api } from "@/convex/_generated/api";
import { exploreQueryParser } from "@/lib/search-params";
import { BundleCard } from "@/components/bundle-card";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton";

export function RecentBundles() {
  const [query] = useQueryState("q", exploreQueryParser);
  const [animOffset, setAnimOffset] = useState(0);

  const { results, status, loadMore } = usePaginatedQuery(
    api.bundles.listPublicPaginated,
    {},
    { initialNumItems: 12 },
  );

  // Client-side name filter
  const filtered = useMemo(() => {
    if (!query) return results;
    const lower = query.toLowerCase();
    return results.filter((b) => b.name.toLowerCase().includes(lower));
  }, [results, query]);

  if (status === "LoadingFirstPage") {
    return (
      <section>
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Recent community bundles
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Recent community bundles
      </h2>

      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {query
              ? "No bundles match your search."
              : "No bundles yet. Be the first to create one!"}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bundle, i) => (
            <div
              key={bundle._id}
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-[both]"
              style={{
                animationDelay: `${Math.max(0, i - animOffset) * 30}ms`,
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

      {status === "CanLoadMore" && (
        <div className="mt-6 text-center">
          <Button
            variant="outline"
            onClick={() => {
              setAnimOffset(filtered.length);
              loadMore(12);
            }}
          >
            Load more
          </Button>
          {query && (
            <p className="mt-2 text-xs text-muted-foreground">
              Searching loaded results only. Load more to search additional
              bundles.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

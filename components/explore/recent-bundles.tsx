"use client";

import { useEffect, useRef } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BundleCard, BundleCardSkeleton } from "@/components/bundle-card";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";

export function RecentBundles() {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { results, status, loadMore } = usePaginatedQuery(
    api.bundles.listPublicPaginated,
    {},
    { initialNumItems: 20 },
  );

  const canLoadMore = status === "CanLoadMore";

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && canLoadMore) {
          loadMore(12);
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, loadMore]);

  const isFirstLoad = status === "LoadingFirstPage";
  const count = results.length;

  return (
    <section>
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
          Latest additions.
          {!isFirstLoad && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              · {count}
            </span>
          )}
        </h2>
      </div>

      {isFirstLoad ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <BundleCardSkeleton key={i} hasStats />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="py-20">
          <p className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
            Be the first to share a bundle.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((bundle) => (
            <BundleCard
              key={bundle._id}
              name={bundle.name}
              urlId={bundle.urlId}
              skillCount={bundle.skillCount}
              createdAt={bundle.createdAt}
              creatorName={bundle.creatorName}
              viewCount={bundle.viewCount}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {status === "LoadingMore" && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <DotMatrixComet size="xs" ariaLabel="Loading more bundles" />
          <span>Loading more</span>
        </div>
      )}
    </section>
  );
}

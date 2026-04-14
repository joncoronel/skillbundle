"use client";

import { useEffect, useRef } from "react";
import { usePaginatedQuery } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { BundleCard, BundleCardSkeleton } from "@/components/bundle-card";

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
      <div className="mb-5 border-b pb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Recent{" "}
          {!isFirstLoad && (
            <>
              <span aria-hidden>&middot;</span>{" "}
              <span className="text-foreground tabular-nums">{count}</span>
            </>
          )}
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight leading-tight">
          Latest additions.
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
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Nothing yet
          </p>
          <p className="mt-3 font-display text-2xl font-semibold tracking-tight leading-tight">
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
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={Loading03Icon}
            strokeWidth={2}
            className="size-3.5 animate-spin"
          />
          <span className="font-mono uppercase tracking-[0.14em] text-[10px]">
            Loading more
          </span>
        </div>
      )}
    </section>
  );
}

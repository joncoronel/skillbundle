"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ExploreSortValue } from "@/lib/search-params";
import { BundleCard, BundleCardSkeleton } from "@/components/bundle-card";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";

interface BundleGridProps {
  sort: ExploreSortValue;
  onSwitchSort: (sort: ExploreSortValue) => void;
}

export function BundleGrid({ sort, onSwitchSort }: BundleGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { results, status, loadMore } = usePaginatedQuery(
    api.bundles.listExplore,
    { sort },
    { initialNumItems: 18 },
  );

  const canLoadMore = status === "CanLoadMore";

  // canLoadMore flips on every scroll batch (LoadingFirstPage → CanLoadMore →
  // LoadingMore → CanLoadMore). Including it in the observer effect's deps
  // would tear down and rebuild the observer on each transition. Stash the
  // latest value in a ref (synced via a no-deps effect) so the observer reads
  // it without being a dep.
  const canLoadMoreRef = useRef(canLoadMore);
  useEffect(() => {
    canLoadMoreRef.current = canLoadMore;
  });

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && canLoadMoreRef.current) {
          loadMore(12);
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const isFirstLoad = status === "LoadingFirstPage";

  if (isFirstLoad) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <BundleCardSkeleton key={i} hasStats />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return <EmptyState sort={sort} onSwitchSort={onSwitchSort} />;
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((bundle) => (
          <BundleCard
            key={bundle._id}
            name={bundle.name}
            urlId={bundle.urlId}
            skillCount={bundle.skillCount}
            createdAt={bundle.createdAt}
            creatorName={bundle.creatorName}
            creatorImage={bundle.creatorImage}
            copyCount={bundle.copyCount}
            forkCount={bundle.forkCount}
            starCount={bundle.starCount}
          />
        ))}
      </div>

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {status === "LoadingMore" ? (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <DotMatrixComet size="xs" ariaLabel="Loading more bundles" />
          <span>Loading more</span>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty states — sharp, dev-tone, one path forward per filter
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  sort: ExploreSortValue;
  onSwitchSort: (sort: ExploreSortValue) => void;
}

function EmptyState({ sort, onSwitchSort }: EmptyStateProps) {
  const router = useRouter();

  // `satisfies` makes adding a new ExploreSortValue without updating this
  // object a compile-time error rather than a silent `undefined` at runtime.
  const config = (
    {
      newest: {
        heading: "No bundles yet.",
        body: "Whoever ships first gets the front page.",
        cta: { label: "Start a bundle", action: () => router.push("/") },
      },
      starred: {
        heading: "Nothing starred yet.",
        body: "Star a bundle from its page to surface it here.",
        cta: { label: "Browse newest", action: () => onSwitchSort("newest") },
      },
    } satisfies Record<
      ExploreSortValue,
      {
        heading: string;
        body: string;
        cta: { label: string; action: () => void };
      }
    >
  )[sort];

  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <h3 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
        {config.heading}
      </h3>
      <p className="max-w-sm text-sm text-muted-foreground">{config.body}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={config.cta.action}
        className="mt-2"
      >
        {config.cta.label}
      </Button>
    </div>
  );
}

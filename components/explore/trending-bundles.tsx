"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { BundleCard, BundleCardSkeleton } from "@/components/bundle-card";

export function TrendingBundles() {
  const { data: bundles, isPending } = useQuery({
    ...convexQuery(api.bundleEvents.getTrendingBundles, { limit: 6 }),
    gcTime: 5 * 60_000,
  });

  if (!isPending && (!bundles || bundles.length === 0)) return null;

  const count = bundles?.length ?? 0;

  return (
    <section>
      <div className="mb-5 border-b pb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Trending{" "}
          {!isPending && (
            <>
              <span aria-hidden>&middot;</span>{" "}
              <span className="text-foreground tabular-nums">{count}</span>
            </>
          )}
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight leading-tight">
          What&rsquo;s hot right now.
        </h2>
      </div>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <BundleCardSkeleton key={i} hasStats />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bundles!.map((bundle) => (
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

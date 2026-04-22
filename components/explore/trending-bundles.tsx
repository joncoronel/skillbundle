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
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
          What&rsquo;s hot right now.
          {!isPending && (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              · {count}
            </span>
          )}
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

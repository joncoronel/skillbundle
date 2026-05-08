"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { BundleCard, BundleCardSkeleton } from "@/components/bundle-card";

const FEATURED_LIMIT = 3;

export function FeaturedShowcase() {
  const { data, isPending } = useQuery({
    ...convexQuery(api.bundles.listFeatured, { limit: FEATURED_LIMIT }),
    gcTime: 5 * 60_000,
  });

  if (!isPending && (!data || data.length === 0)) return null;

  return (
    <section>
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
          Featured.
        </h2>
      </div>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: FEATURED_LIMIT }).map((_, i) => (
            <BundleCardSkeleton key={i} hasStats />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.map((bundle) => (
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
              hideCreator
            />
          ))}
        </div>
      )}
    </section>
  );
}

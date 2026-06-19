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
      <h2 className="mb-5 text-xl font-semibold tracking-tight">Featured.</h2>

      {/* Same card and grid as the Newest/search results below — one bundle
          card vocabulary across the page. The "Featured." heading and ordering
          carry the emphasis, not a separate card design. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isPending
          ? Array.from({ length: FEATURED_LIMIT }).map((_, i) => (
              <BundleCardSkeleton key={i} hasStats />
            ))
          : data!.map((bundle) => (
              <BundleCard
                key={bundle._id}
                name={bundle.name}
                urlId={bundle.urlId}
                description={bundle.description}
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
    </section>
  );
}

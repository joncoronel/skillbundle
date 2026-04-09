"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BundleCard } from "@/components/bundle-card";

export function TrendingBundles({
  preloadedBundles,
}: {
  preloadedBundles: Preloaded<typeof api.bundleEvents.getTrendingBundles>;
}) {
  const bundles = usePreloadedQuery(preloadedBundles);

  if (bundles.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Trending bundles
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bundles.map((bundle, i) => (
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
              isTrending
            />
          </div>
        ))}
      </div>
    </section>
  );
}

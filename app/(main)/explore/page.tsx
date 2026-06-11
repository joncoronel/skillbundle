import { Suspense } from "react";

import { ExploreFallback } from "@/components/explore/explore-fallback";
import { ExploreContent } from "./explore-content";

export default function ExplorePage() {
  // The page is static. <ExploreContent> reads search params (nuqs), which
  // suspends during prerendering — the fallback renders the identical default
  // browse state so the prerendered HTML is a full-looking page and the route
  // stays prefetchable. After hydration the live tree applies any URL params.

  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <header>
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-semibold tracking-tight leading-hero text-balance">
          Explore.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          What the community is building, right now.
        </p>
      </header>

      <div className="mt-10 space-y-14">
        <Suspense fallback={<ExploreFallback />}>
          <ExploreContent />
        </Suspense>
      </div>
    </main>
  );
}

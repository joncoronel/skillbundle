"use client";

import { ExploreFiltersView } from "./explore-filters";
import { FeaturedShowcase } from "./featured-showcase";
import { ExploreTabsView } from "./explore-tabs";

const noop = () => {};

/**
 * Static-shell stand-in for <ExploreContent>. The live tree reads search
 * params (nuqs), which suspends during prerendering — this fallback renders
 * the identical default browse state (inert search input, Featured + tabs
 * with their own pending skeletons) so the prerendered HTML is a full-looking
 * page. After hydration React swaps in the live tree.
 */
export function ExploreFallback() {
  return (
    <>
      <ExploreFiltersView
        query=""
        loading={false}
        onQueryChange={noop}
        onClear={noop}
      />
      <div className="space-y-14">
        <FeaturedShowcase />
        <ExploreTabsView sort="newest" onSortChange={noop} />
      </div>
    </>
  );
}

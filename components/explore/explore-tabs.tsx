"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";
import { exploreSortParser, type ExploreSortValue } from "@/lib/search-params";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import { BundleGrid } from "./bundle-grid";

const OPTIONS: ReadonlyArray<{ value: ExploreSortValue; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "starred", label: "Most starred" },
];

export function ExploreTabs() {
  const [sort, setSort] = useQueryState("sort", exploreSortParser);

  // Lazy-but-sticky: only mount BundleGrid for tabs the user has visited,
  // then keep them mounted (TabsContent keepMounted) so subsequent tab
  // switches don't re-fetch the page or flash the skeleton.
  //
  // The setState-during-render below is React's documented "derived from
  // props" pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // The `if (!has(sort))` guard is load-bearing: React renders this component
  // twice — first run schedules the state update and discards the render,
  // second run sees the new Set, the guard is false, no further updates.
  // Without the guard this would loop infinitely.
  const [visitedTabs, setVisitedTabs] = useState<Set<ExploreSortValue>>(
    () => new Set([sort]),
  );
  if (!visitedTabs.has(sort)) {
    setVisitedTabs((prev) => new Set([...prev, sort]));
  }

  const handleSwitchSort = (next: ExploreSortValue) => {
    // Strip the param when it matches the default so the URL stays clean.
    setSort(next === "newest" ? null : next);
  };

  return (
    <Tabs
      value={sort}
      onValueChange={(value) => {
        handleSwitchSort(value as ExploreSortValue);
      }}
    >
      <TabsList
        variant="underline"
        aria-label="Sort bundles"
        className="**:data-[slot=tab-indicator]:bg-primary mb-5"
      >
        {OPTIONS.map((opt) => (
          <TabsTrigger key={opt.value} value={opt.value}>
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsPanels>
        {OPTIONS.map((opt) => (
          <TabsContent keepMounted key={opt.value} value={opt.value}>
            {visitedTabs.has(opt.value) ? (
              <BundleGrid sort={opt.value} onSwitchSort={handleSwitchSort} />
            ) : null}
          </TabsContent>
        ))}
      </TabsPanels>
    </Tabs>
  );
}

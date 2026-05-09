"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { useQueryState } from "nuqs";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { exploreQueryParser } from "@/lib/search-params";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { Button } from "@/components/ui/cubby-ui/button";
import { ExploreFilters } from "@/components/explore/explore-filters";
import { FeaturedShowcase } from "@/components/explore/featured-showcase";
import { ExploreTabs } from "@/components/explore/explore-tabs";
import { BundleCard } from "@/components/bundle-card";

type BundleSearchResults = FunctionReturnType<typeof api.bundles.searchPublic>;

export function ExploreContent() {
  const [query, setQuery] = useQueryState("q", exploreQueryParser);
  const trimmedQuery = query.trim();
  // Debounce with synchronous reset on clear — without that, a fast retype
  // after clearing would see the previous query's debounced value leak through
  // (e.g. type "f", clear, type "g" within 300ms → effectiveQuery briefly
  // resolves to "f" and `hasSettled` flips back to true on the cached "f"
  // hit, crossfading the user to the wrong query's results).
  const [debouncedQuery, setDebouncedQuery] = useState(trimmedQuery);
  if (!trimmedQuery && debouncedQuery) {
    setDebouncedQuery("");
  }
  useEffect(() => {
    if (!trimmedQuery) return;
    const timer = setTimeout(() => setDebouncedQuery(trimmedQuery), 300);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);
  // If raw query is empty, bypass debounce and show browse view immediately.
  const effectiveQuery = trimmedQuery ? debouncedQuery : "";

  const {
    data: results,
    isFetching,
    isPlaceholderData,
  } = useQuery({
    ...convexQuery(
      api.bundles.searchPublic,
      effectiveQuery ? { query: effectiveQuery } : "skip",
    ),
    // Keep prior rows visible during refinement ("d" → "dd") so the user
    // never sees the results disappear into a skeleton between keystrokes.
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });

  // Has the current search session settled at least once? Gates the crossfade:
  //   - First search (""→"d"): browse stays until "d" lands → flips true → crossfade
  //   - Refinement ("d"→"dd"): stays true; placeholder keeps "d" rows visible
  //   - Clear: resets to false → crossfade back to browse
  //   - Fresh after clear ("d"→clear→"g"): false again until "g" lands (no stale flash)
  const [hasSettled, setHasSettled] = useState(false);
  if (!effectiveQuery && hasSettled) setHasSettled(false);
  if (
    effectiveQuery &&
    results !== undefined &&
    !isPlaceholderData &&
    !hasSettled
  ) {
    setHasSettled(true);
  }

  const showResults = effectiveQuery.length > 0 && hasSettled;
  const isInputLoading =
    trimmedQuery.length > 0 &&
    (trimmedQuery !== effectiveQuery || isFetching || isPlaceholderData);

  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <ExploreFilters ref={inputRef} loading={isInputLoading} />
      <Crossfade active={showResults}>
        {/* Browse state */}
        <div className="space-y-14">
          <FeaturedShowcase />
          <ExploreTabs />
        </div>
        {/* Search state */}
        <SearchResults
          query={effectiveQuery}
          results={results}
          onClear={() => setQuery(null)}
        />
      </Crossfade>
    </>
  );
}

function SearchResults({
  query,
  results,
  onClear,
}: {
  query: string;
  results: BundleSearchResults | undefined;
  onClear: () => void;
}) {
  // Parent gates visibility via Crossfade once results are settled — but the
  // child stays mounted underneath browse mode while the first fetch is in
  // flight. Bail out cleanly until data arrives.
  if (!results) return null;

  const count = results.length;

  return (
    <section>
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
          &ldquo;{query}&rdquo;
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            · {count}
          </span>
        </h2>
      </div>
      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={1.5}
            className="size-8 text-muted-foreground/40"
          />
          <p className="text-sm text-muted-foreground">
            No bundles match that search.
          </p>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear search
          </Button>
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
              creatorImage={bundle.creatorImage}
              copyCount={bundle.copyCount}
              forkCount={bundle.forkCount}
              starCount={bundle.starCount}
            />
          ))}
        </div>
      )}
    </section>
  );
}

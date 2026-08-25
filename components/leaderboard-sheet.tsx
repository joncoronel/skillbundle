"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { FireIcon } from "@hugeicons/core-free-icons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/cubby-ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/cubby-ui/tabs";
import {
  SkillRowGrid,
  EmptyState,
  rowToSkill,
} from "@/components/default-skills-list";
import { api } from "@/convex/_generated/api";
import type { LeaderboardViewValue } from "@/lib/search-params";

interface LeaderboardSheetProps {
  /** null = closed; "hot"/"trending" = open on that tab (URL-backed, ?view=). */
  view: LeaderboardViewValue | null;
  onViewChange: (view: LeaderboardViewValue | null) => void;
}

/** Rows per leaderboard. Matches what the server used to prefetch. */
const HOT_LIMIT = 30;
const TRENDING_LIMIT = 60;

/**
 * Fetches one leaderboard, and only while its tab is the open one.
 *
 * These lists used to be fetched on the server and handed down as props. They
 * render nowhere except this sheet, which starts closed, so every visitor paid
 * to serialize 90 skill rows into the home page for a surface most never open:
 * 90 of the page's 120 rows, in a 400KB document. Worse, Cache Components keeps
 * a navigated-away route mounted, so those rows stayed on the heap behind the
 * next page and pushed GC into interactions elsewhere.
 *
 * Keyed on the active tab rather than fetching both, because `?view=` already
 * names one and React Query caches per key: switching tabs fetches once and is
 * instant thereafter.
 */
function useLeaderboard(active: LeaderboardViewValue, open: boolean) {
  const hot = useQuery({
    ...convexQuery(api.leaderboards.listHot, { limit: HOT_LIMIT }),
    // Gated on the tab, not on `view`: `view` drops to null the moment closing
    // starts, and disabling there would empty the list mid-slide-out.
    enabled: open && active === "hot",
    staleTime: 5 * 60_000,
  });
  const trending = useQuery({
    ...convexQuery(api.leaderboards.listTrending, {
      paginationOpts: { numItems: TRENDING_LIMIT, cursor: null },
    }),
    enabled: open && active === "trending",
    staleTime: 5 * 60_000,
  });

  const source = active === "hot" ? hot : trending;
  const rows = active === "hot" ? hot.data : trending.data?.page;
  return {
    skills: (rows ?? []).map(rowToSkill),
    // `isLoading` is false for a cached tab, so reopening does not flash.
    isLoading: source.isLoading,
  };
}

const CAPTIONS: Record<LeaderboardViewValue, string> = {
  hot: "Most installed in the last hour on skills.sh",
  trending: "Most installed in the last 24 hours on skills.sh",
};

/**
 * The Hot/Trending leaderboards, in their own sheet — deliberately OFF the
 * catalog surface. The composer's search/sort/filters parametrize the catalog
 * query and nothing else; these lists are fixed leaderboard subsets that
 * ignore all of it, so giving them a separate surface (with its own tabs)
 * is what keeps the composer from ever pointing at a list it doesn't control.
 *
 * Rows reuse SkillRowGrid, so add-to-bundle checkboxes and the skill detail
 * sheet work here exactly as they do in the catalog.
 */
export function LeaderboardSheet({
  view,
  onViewChange,
}: LeaderboardSheetProps) {
  // Hold the last real view while closing so the content doesn't flip
  // mid-exit-animation (view goes null the moment close starts — a bare
  // `?? "hot"` would swap Trending's content to Hot during the slide-out).
  const [lastView, setLastView] = useState<LeaderboardViewValue>("hot");
  if (view !== null && view !== lastView) setLastView(view);
  const active: LeaderboardViewValue = view ?? lastView;
  const { skills, isLoading } = useLeaderboard(active, view !== null);

  return (
    <Sheet
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) onViewChange(null);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Leaderboards</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-2">
          <Tabs
            value={active}
            onValueChange={(v) => onViewChange(v as LeaderboardViewValue)}
          >
            <TabsList
              variant="capsule"
              size="small"
              aria-label="Leaderboard"
              className="w-full"
            >
              <TabsTrigger value="hot" className="flex-1">
                <HugeiconsIcon
                  icon={FireIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
                Hot
              </TabsTrigger>
              <TabsTrigger value="trending" className="flex-1">
                Trending
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">{CAPTIONS[active]}</p>
          <div className="pt-1">
            {isLoading ? (
              <LeaderboardSkeleton />
            ) : skills.length === 0 ? (
              <EmptyState message="No leaderboard data yet — check back after the next sync." />
            ) : (
              <SkillRowGrid skills={skills} metric={active} />
            )}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Row-shaped placeholder for the first open of a tab. Sized to the real rows so
 * the list does not jump when they arrive.
 */
function LeaderboardSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          className="flex items-center gap-3 border-b border-border/60 py-3"
          key={i}
        >
          <div className="size-4 shrink-0 rounded bg-muted/60" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-2/5 rounded bg-muted/60" />
            <div className="h-3 w-3/5 rounded bg-muted/40" />
          </div>
          <div className="h-3 w-12 shrink-0 rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}

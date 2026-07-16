"use client";

import { useState } from "react";
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
import { SkillRowGrid, EmptyState } from "@/components/default-skills-list";
import type { SkillData } from "@/components/skill-card";
import type { LeaderboardViewValue } from "@/lib/search-params";

interface LeaderboardSheetProps {
  /** null = closed; "hot"/"trending" = open on that tab (URL-backed, ?view=). */
  view: LeaderboardViewValue | null;
  onViewChange: (view: LeaderboardViewValue | null) => void;
  hotSkills: SkillData[];
  trendingSkills: SkillData[];
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
  hotSkills,
  trendingSkills,
}: LeaderboardSheetProps) {
  // Hold the last real view while closing so the content doesn't flip
  // mid-exit-animation (view goes null the moment close starts — a bare
  // `?? "hot"` would swap Trending's content to Hot during the slide-out).
  const [lastView, setLastView] = useState<LeaderboardViewValue>("hot");
  if (view !== null && view !== lastView) setLastView(view);
  const active: LeaderboardViewValue = view ?? lastView;
  const skills = active === "hot" ? hotSkills : trendingSkills;

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
            {skills.length === 0 ? (
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

"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/cubby-ui/input";
import { Kbd } from "@/components/ui/cubby-ui/kbd";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { DefaultSkillsListView } from "@/components/default-skills-list";
import { createSkillDetailHandle } from "@/components/skill-detail-sheet";
import type { api } from "@/convex/_generated/api";

type HomeFallbackProps = {
  hero: ReactNode;
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
  initialTrending: FunctionReturnType<typeof api.leaderboards.listTrending>;
  initialHot: FunctionReturnType<typeof api.leaderboards.listHot>;
};

const noop = () => {};

// Never opened pre-hydration — the sheet itself isn't mounted here.
const fallbackSheetHandle = createSkillDetailHandle();

/**
 * Static-shell stand-in for <HomeContent>. The live tree reads search params
 * (nuqs/useSearchParams), which suspends during prerendering — this fallback
 * renders the identical default no-params state with real leaderboard data so
 * the prerendered HTML is the full page, not a blank shell. After hydration
 * React swaps in the live tree (identical when no params are set).
 *
 * Keep the search bar markup in sync with the text-mode default state of
 * components/skill-explorer.tsx (including the Crossfade wrapper around the
 * leaderboard — the live tree's no-query state renders the search pane as a
 * hidden null slot), and the wrappers in sync with
 * app/(main)/home-content.tsx.
 */
export function HomeFallback({
  hero,
  initialPopularSkills,
  initialTrending,
  initialHot,
}: HomeFallbackProps) {
  return (
    <>
      {hero}
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20">
        <Tabs value="text" onValueChange={noop}>
          <TabsList variant="underline" className="mb-3">
            <TabsTrigger value="text">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              Search
            </TabsTrigger>
            <TabsTrigger value="repo">
              <HugeiconsIcon
                icon={GithubIcon}
                strokeWidth={2}
                className="size-3.5"
              />
              Repo
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
              />
              <Input
                placeholder="Search skills by name…"
                value=""
                readOnly
                className="pl-9 pr-9"
              />
              <Kbd
                size="sm"
                variant="ghost"
                className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none max-sm:hidden"
                aria-hidden="true"
              >
                /
              </Kbd>
            </div>
          </div>

          <TabsPanels>
            <TabsContent value="text">
              {/* Wrapper divs + classes mirror the live Crossfade panes in
                  components/skill-explorer.tsx (the dim's transition-opacity
                  base, never the loading opacity here) so the prerendered DOM
                  matches the hydrated tree and the swap doesn't flash. */}
              <Crossfade active={false}>
                <div className="transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none">
                  <DefaultSkillsListView
                    tab="popular"
                    onTabChange={noop}
                    initialPage={initialPopularSkills}
                    initialTrending={initialTrending}
                    initialHot={initialHot}
                    sheetHandle={fallbackSheetHandle}
                  />
                </div>
                <div className="transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none">
                  {null}
                </div>
              </Crossfade>
            </TabsContent>
          </TabsPanels>
        </Tabs>
      </main>
    </>
  );
}

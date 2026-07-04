"use client";

import type { FunctionReturnType } from "convex/server";
import {
  SkillExplorer,
  SkillExplorerView,
  ENTRY_STATE_DEFAULTS,
} from "@/components/skill-explorer";
import { useUserPlan } from "@/hooks/use-user-plan";
import type { api } from "@/convex/_generated/api";

type HomeContentProps = {
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
  initialTrending: FunctionReturnType<typeof api.leaderboards.listTrending>;
  initialHot: FunctionReturnType<typeof api.leaderboards.listHot>;
};

// The hero + search + rail + catalog all live inside SkillExplorer (the
// discovery surface — see components/skill-explorer.tsx). SkillExplorer reads
// search params via nuqs' Next adapter, so under Cache Components it's dynamic
// and app/(main)/page.tsx wraps it in Suspense with <HomeFallback> below.
export function HomeContent({
  initialPopularSkills,
  initialTrending,
  initialHot,
}: HomeContentProps) {
  const { limits } = useUserPlan();

  return (
    <main className="mx-auto max-w-6xl px-4">
      <SkillExplorer
        canAutoDetect={limits?.canAutoDetect ?? true}
        initialPopularSkills={initialPopularSkills}
        initialTrending={initialTrending}
        initialHot={initialHot}
      />
    </main>
  );
}

/**
 * Static-shell stand-in for <HomeContent>. HomeContent's SkillExplorer reads
 * search params (nuqs/useSearchParams), which suspends during prerendering —
 * this fallback renders the identical default no-params entry state from
 * ENTRY_STATE_DEFAULTS (real leaderboard data, noop setters) so the prerendered
 * HTML is the full page. After hydration React swaps in the live tree —
 * identical when no params are set, so the common load has no visible flash.
 *
 * The <main> wrapper mirrors HomeContent above — keep them in sync.
 */
export function HomeFallback({
  initialPopularSkills,
  initialTrending,
  initialHot,
}: HomeContentProps) {
  return (
    <main className="mx-auto max-w-6xl px-4">
      <SkillExplorerView
        {...ENTRY_STATE_DEFAULTS}
        canAutoDetect
        initialPopularSkills={initialPopularSkills}
        initialTrending={initialTrending}
        initialHot={initialHot}
      />
    </main>
  );
}

"use client";

import type { FunctionReturnType } from "convex/server";
import { SkillExplorer, SkillExplorerView } from "@/components/skill-explorer";
import { ExplorerStaticProvider } from "@/components/explorer-state";
import type { api } from "@/convex/_generated/api";

type HomeContentProps = {
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
};

// The hero + search + rail + catalog all live inside SkillExplorer (the
// discovery surface — see components/skill-explorer.tsx). SkillExplorer reads
// search params via nuqs' Next adapter, so under Cache Components it's dynamic
// and app/(main)/page.tsx wraps it in Suspense with <HomeFallback> below.
export function HomeContent({ initialPopularSkills }: HomeContentProps) {
  return <SkillExplorer initialPopularSkills={initialPopularSkills} />;
}

/**
 * Static-shell stand-in for <HomeContent>. HomeContent's SkillExplorer reads
 * search params (nuqs/useSearchParams), which suspends during prerendering —
 * this fallback renders the identical view under ExplorerStaticProvider (the
 * no-params entry state, derived mechanically from the URL parsers, with noop
 * setters) so the prerendered HTML is the full page. After hydration React
 * swaps in the live tree — identical when no params are set, so the common
 * load has no visible flash.
 */
export function HomeFallback({ initialPopularSkills }: HomeContentProps) {
  return (
    <ExplorerStaticProvider>
      <SkillExplorerView initialPopularSkills={initialPopularSkills} />
    </ExplorerStaticProvider>
  );
}

"use client";

import type { FunctionReturnType } from "convex/server";
import { SkillExplorerView } from "@/components/skill-explorer";
import { ExplorerStaticProvider } from "@/components/explorer-state";
import type { api } from "@/convex/_generated/api";

type HomeFallbackProps = {
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
};

/**
 * Static-shell stand-in for `<SkillExplorer>`, which the page renders directly.
 *
 * The hero, search, rail and catalog all live inside SkillExplorer (the
 * discovery surface). It reads search params via nuqs' Next adapter, which
 * suspends during prerendering, so `app/(main)/page.tsx` wraps it in Suspense
 * with this as the fallback: the identical view under ExplorerStaticProvider
 * (the no-params entry state, derived mechanically from the URL parsers, with
 * noop setters) so the prerendered HTML is the full page. After hydration React
 * swaps in the live tree — identical when no params are set, so the common load
 * has no visible flash.
 *
 * There used to be a `HomeContent` beside this, forwarding one prop to
 * SkillExplorer and nothing else. It earned its place while it passed three.
 */
export function HomeFallback({ initialPopularSkills }: HomeFallbackProps) {
  return (
    <ExplorerStaticProvider>
      <SkillExplorerView initialPopularSkills={initialPopularSkills} />
    </ExplorerStaticProvider>
  );
}

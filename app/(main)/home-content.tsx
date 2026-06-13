"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { SkillExplorer } from "@/components/skill-explorer";
import { useUserPlan } from "@/hooks/use-user-plan";
import type { api } from "@/convex/_generated/api";

type HomeContentProps = {
  children: ReactNode;
  initialPopularSkills: FunctionReturnType<
    typeof api.skills.listPopularSkills
  >;
  initialTrending: FunctionReturnType<
    typeof api.leaderboards.listTrending
  >;
  initialHot: FunctionReturnType<typeof api.leaderboards.listHot>;
};

// The hero (children) is a compact static band — it never collapses on
// search; typing crossfades the explorer's results pane in place instead.
// Wrapper markup is mirrored statically in app/(main)/home-fallback.tsx —
// keep the two in sync or the post-hydration swap flashes.
export function HomeContent({
  children,
  initialPopularSkills,
  initialTrending,
  initialHot,
}: HomeContentProps) {
  const { limits } = useUserPlan();

  return (
    <>
      {children}
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-20">
        <SkillExplorer
          canAutoDetect={limits?.canAutoDetect ?? true}
          initialPopularSkills={initialPopularSkills}
          initialTrending={initialTrending}
          initialHot={initialHot}
        />
      </main>
    </>
  );
}

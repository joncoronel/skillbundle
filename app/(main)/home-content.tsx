"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { SkillExplorer } from "@/components/skill-explorer";
import { useUserPlan } from "@/hooks/use-user-plan";
import { HeroCollapse } from "./hero-collapse";
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

export function HomeContent({
  children,
  initialPopularSkills,
  initialTrending,
  initialHot,
}: HomeContentProps) {
  const { limits } = useUserPlan();

  return (
    <>
      <HeroCollapse>{children}</HeroCollapse>
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

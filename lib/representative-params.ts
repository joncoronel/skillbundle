import "server-only";
import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { isGitHubSource } from "@/lib/skill-urls";

type PopularPage = FunctionReturnType<typeof api.skills.listPopularSkills>;

// Cache Components requires `generateStaticParams` to return at least one param
// so Next can prerender each catalog route's App Shell. Every other org / repo /
// skill is served that shell instantly and upgraded in the background on its
// first visit, so one real, non-delisted value per route is all we need here.
//
// We read the most popular skill of each source type (GitHub `owner/repo` vs
// well-known dotted domain) and fall back to a known-good slug if the
// popular-skills query fails, so param *selection* always yields a valid,
// non-delisted page with no hardcoded slug to rot. (Rendering that one prebuilt
// page still queries Convex like any catalog page — the fallback hardens which
// param we pick, not the whole build. Convex being down at build fails the
// render regardless.)

type Representative = { source: string; skillId: string };

const GITHUB_FALLBACK: Representative = {
  source: "vercel-labs/skills",
  skillId: "find-skills",
};
const WELL_KNOWN_FALLBACK: Representative = {
  source: "open.feishu.cn",
  skillId: "lark-approval",
};

async function topSkillOfType(
  wantGitHub: boolean,
  fallback: Representative,
): Promise<Representative> {
  try {
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const res: PopularPage = await fetchQuery(api.skills.listPopularSkills, {
        paginationOpts: { numItems: 100, cursor },
      });
      const hit = res.page.find(
        (s) => isGitHubSource(s.source) === wantGitHub && Boolean(s.skillId),
      );
      if (hit) return { source: hit.source, skillId: hit.skillId };
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
  } catch {
    // fall through to the static fallback below
  }
  return fallback;
}

// Memoized at module scope so the build resolves each lookup once, not once per
// catalog route that calls it — the same pattern used for the OG fonts in
// lib/og/fonts.ts. (5 catalog routes call these; without the memo the build
// re-runs the scan for each.)
let cachedGitHub: Promise<Representative> | undefined;
let cachedWellKnown: Promise<Representative> | undefined;

export function representativeGitHubSkill(): Promise<Representative> {
  return (cachedGitHub ??= topSkillOfType(true, GITHUB_FALLBACK));
}

export function representativeWellKnownSkill(): Promise<Representative> {
  return (cachedWellKnown ??= topSkillOfType(false, WELL_KNOWN_FALLBACK));
}

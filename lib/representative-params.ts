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
// well-known dotted domain) and fall back to a known-good slug if Convex is
// unreachable at build time, so the build never depends on a live backend.

const GITHUB_FALLBACK = { source: "vercel-labs/skills", skillId: "find-skills" };
const WELL_KNOWN_FALLBACK = {
  source: "open.feishu.cn",
  skillId: "lark-approval",
};

async function topSkillOfType(
  wantGitHub: boolean,
  fallback: { source: string; skillId: string },
): Promise<{ source: string; skillId: string }> {
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

export async function representativeGitHubSkill() {
  return topSkillOfType(true, GITHUB_FALLBACK);
}

export async function representativeWellKnownSkill() {
  return topSkillOfType(false, WELL_KNOWN_FALLBACK);
}

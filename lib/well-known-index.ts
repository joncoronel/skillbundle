import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SKILL_SYNC_TAG } from "@/lib/cache-tags";
import { isGitHubSource } from "@/lib/skill-urls";
import type { WellKnownIndexes } from "@/lib/install-commands";

/**
 * Which skills a well-known source's index advertises, and where that index
 * lives, for the site pages that build install commands. See convex/wellKnown.ts
 * for what fills the table and why the answer can't be derived from the domain.
 *
 * Returns an empty map for GitHub sources WITHOUT calling Convex — ~98% of the
 * catalog is GitHub, and the builders ignore the map for those anyway, so a
 * round trip there would buy nothing. Callers can hand this any source rather
 * than branching first.
 *
 * `'use cache'` for the same reason loadSourceSkills has it: it isolates
 * `fetchQuery`'s no-store fetch behind a cache boundary so the route still
 * prerenders, and keys on (function identity + args) so `generateMetadata` and
 * the page body share one entry. Tagged "skill-sync" so a manual sync ping
 * refreshes it; the underlying table only changes weekly.
 */
export async function loadWellKnownIndexes(
  source: string,
): Promise<WellKnownIndexes> {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  if (isGitHubSource(source)) return {};
  return await fetchQuery(api.wellKnown.wellKnownSkillNames, {
    sources: [source],
  });
}

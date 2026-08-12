/**
 * The post-add chain every manual add path fires after its upsert, extracted
 * so the normal add (skills.ts manualAddCore) and the GitHub-only add
 * (githubOnly.ts addGitHubCore) can't drift:
 *
 *   1. Drain discovery + content-fetch + audit so the new row's SKILL.md and
 *      audit data fill in within seconds. Idempotent — if the row already
 *      exists, the workers find nothing flagged and exit.
 *   2. Bust the skill-page cache immediately. The detail page is ISR'd and a
 *      path visited BEFORE the add has a cached notFound() render that would
 *      otherwise persist for up to 24h. Needs BOTH skill tags: the cached
 *      notFound comes from loadSkill ("skill-content"), while the sidebar's
 *      install/version data comes from loadSkillSyncData ("skill-sync"). A
 *      brand-new row moves both, so unlike the daily jobs this path is not a
 *      candidate for pinging just one. Best-effort — revalidateSiteTag
 *      swallows errors and no-ops in dev.
 *   3. Index this one skill into Typesense now instead of waiting for the
 *      daily mark-and-sweep, so it's searchable within seconds. `description`
 *      is the SKILL.md description the caller already resolved, so the first
 *      indexed doc is complete rather than name-only.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { revalidateSiteTag } from "./revalidate";

export async function kickPostAddChain(
  ctx: ActionCtx,
  args: { source: string; skillId: string; description?: string },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.skills.backfillDiscoverUrls, {});
  // In parallel, not sequentially: this runs inside the add request the user is
  // waiting on, and each ping carries its own 5s timeout (see revalidateSiteTag),
  // so serial awaits would put a 10s worst-case block in front of the response.
  // Both calls swallow their own errors, so Promise.all cannot reject.
  await Promise.all([
    revalidateSiteTag("skill-content"),
    revalidateSiteTag("skill-sync"),
  ]);
  await ctx.scheduler.runAfter(0, internal.typesense.indexSkill, {
    source: args.source,
    skillId: args.skillId,
    ...(args.description !== undefined && { description: args.description }),
  });
}

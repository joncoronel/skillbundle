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
 *
 *      This ping publishes whatever the row holds RIGHT NOW, and loadSkill
 *      caches that on cacheLife("weeks"). Since step 1 only SCHEDULES the
 *      content fetch, that used to mean publishing a row with no SKILL.md and
 *      holding it until the content chain's terminal publishSkillUpdate landed
 *      — the "page loaded, content empty, reload fixed it" report. Two things
 *      close it, and both belong to the callers rather than here:
 *
 *        - The normal add seeds description + content from the v1 detail
 *          response it already fetched, BEFORE calling this
 *          (skills.seedManualAddContent), so there is real content to publish.
 *        - When the content chain later writes a user-added row's first
 *          content, it publishes then and there rather than waiting for its
 *          own terminal (`publishNow` on contentWriteOutcome). That covers the
 *          GitHub-only add, which has nothing to seed at this point, and the
 *          case where skills.sh's copy was behind GitHub's.
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

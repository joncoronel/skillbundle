/**
 * The post-add chain every manual add path fires after its upsert, extracted
 * so the normal add (skills.ts manualAddCore) and the GitHub-only add
 * (githubOnly.ts addGitHubCore) can't drift:
 *
 *   1. Drain discovery + content-fetch + audit so the new row's SKILL.md and
 *      audit data fill in within seconds. Idempotent — if the row already
 *      exists, the workers find nothing flagged and exit.
 *   2. Bust the skill-page cache immediately. The detail page is ISR'd and its
 *      loadSkill data cache is tagged "skill-sync"; a path visited BEFORE the
 *      add has a cached notFound() render that would otherwise persist for up
 *      to 24h. Best-effort — revalidateHomeTag swallows errors and no-ops in
 *      dev.
 *   3. Index this one skill into Typesense now instead of waiting for the
 *      daily mark-and-sweep, so it's searchable within seconds. `description`
 *      is the SKILL.md description the caller already resolved, so the first
 *      indexed doc is complete rather than name-only.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { revalidateHomeTag } from "./revalidate";

export async function kickPostAddChain(
  ctx: ActionCtx,
  args: { source: string; skillId: string; description?: string },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.skills.backfillDiscoverUrls, {});
  await revalidateHomeTag("skill-sync");
  await ctx.scheduler.runAfter(0, internal.typesense.indexSkill, {
    source: args.source,
    skillId: args.skillId,
    ...(args.description !== undefined && { description: args.description }),
  });
}

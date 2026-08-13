/**
 * The post-add chain every add path fires after its upsert, extracted so the
 * normal add (skills.ts manualAddCore) and the GitHub-only add (githubOnly.ts
 * addGitHubCore) can't drift:
 *
 *   1. Seed the row with the SKILL.md the caller already downloaded, so the
 *      page is complete the first time it renders (skills.seedAddedSkillContent
 *      documents the why, including why no `syncHash` goes with it).
 *
 *      This step lives HERE, ahead of step 3, rather than in the callers,
 *      because its whole value is in the ordering: step 3 publishes whatever
 *      the row holds at that moment, and loadSkill then caches that on
 *      cacheLife("weeks"). Seed after the bust and you publish the empty
 *      version and sit on it. When it was the callers' job, exactly one of the
 *      two did it — the GitHub-only add kept shipping the bug this chain
 *      exists to prevent, and a comment here claimed it had nothing to seed.
 *      Both callers now hand over what they parsed; skipping the seed is no
 *      longer something a caller can do by omission.
 *
 *      Fill-only, so it cannot regress a relisted row that already carries
 *      real content.
 *   2. Drain discovery + content-fetch + audit so the row's SKILL.md and audit
 *      data reach their authoritative values (GitHub for content) within
 *      seconds. Idempotent — if the row already exists, the workers find
 *      nothing flagged and exit. The seed above is a stopgap for the page, not
 *      a replacement for this.
 *   3. Bust the skill-page cache immediately. The detail page is ISR'd and a
 *      path visited BEFORE the add has a cached notFound() render that would
 *      otherwise persist for up to 24h. Needs BOTH skill tags: the cached
 *      notFound comes from loadSkill ("skill-content"), while the sidebar's
 *      install/version data comes from loadSkillSyncData ("skill-sync"). A
 *      brand-new row moves both, so unlike the daily jobs this path is not a
 *      candidate for pinging just one. Best-effort — revalidateSiteTag
 *      swallows errors and no-ops in dev.
 *
 *      When step 2 later writes this row's first real content, it publishes
 *      again from inside that write's own transaction
 *      (skills.publishFirstUserAddedContent) — which is what covers the case
 *      where the seeded copy was behind GitHub's, and the case where there was
 *      nothing to seed at all.
 *   4. Index this one skill into Typesense now instead of waiting for the
 *      daily mark-and-sweep, so it's searchable within seconds. `description`
 *      is the SKILL.md description the caller already resolved, so the first
 *      indexed doc is complete rather than name-only.
 */

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { revalidateSiteTag } from "./revalidate";

export async function kickPostAddChain(
  ctx: ActionCtx,
  args: {
    source: string;
    skillId: string;
    /** SKILL.md frontmatter description, if the caller could parse one. */
    description?: string;
    /** SKILL.md body, frontmatter stripped — same shape as `skills.content`. */
    content?: string;
  },
): Promise<void> {
  if (args.description !== undefined || args.content !== undefined) {
    await ctx.runMutation(internal.skills.seedAddedSkillContent, {
      source: args.source,
      skillId: args.skillId,
      ...(args.description !== undefined && { description: args.description }),
      ...(args.content !== undefined && { content: args.content }),
    });
  }
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

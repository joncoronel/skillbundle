/**
 * Category tagging: the `needsTagging` work-set, drained by `tagSkillsBatch`.
 *
 * Same shape as the embedding worker in skills.ts, and flagged in the same
 * places (insert, relist, a real description/body change; cleared on delist).
 * It's scheduled next to `embedSkillsBatch` at the end of both content chains.
 *
 * Tags are written a few seconds after the chain that changed the content, so
 * they usually land before that chain's `publishSkillUpdate` ping and the 07:00
 * Typesense sync. A large batch can miss both. Those tags then reach the skill
 * page and search one day late, which is fine for tags; this chain adds no
 * cache ping of its own.
 *
 * Only re-tagged when content changes (or `markAllForTagging` is run after a
 * definitions change). Jev's scores move by about ±0.02 between identical
 * requests, so re-tagging unchanged skills would make borderline tags flicker.
 *
 * Two chains can overlap (the raw-content and well-known chains each start
 * one). The worst case is a skill tagged twice, which costs a fraction of a
 * cent, so there is no lock.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { CATEGORIES_VERSION, deriveTags } from "./lib/categories";
import {
  categorizeSkill,
  hasTypeSafeKey,
  SKILL_CONTENT_CHARS,
  TaggingInputRejectedError,
  type SkillCategorization,
} from "./lib/jev";

// Constants, not args, for the reason given on EMBED_BATCH_SIZE in skills.ts:
// scheduled calls capture their args, so an arg would outlive a deploy.
//
// The limit that matters is Jev's 1,200 requests/minute. A batch of 25 runs
// in parallel in well under a second (~0.2s per request), then waits the
// chain delay, so the chain peaks around 750 requests/minute.
const TAG_BATCH_SIZE = 25;
const TAG_CHAIN_DELAY_MS = 1_500;

export const listSkillsNeedingTagging = internalQuery({
  args: { cursor: v.optional(v.string()), limit: v.number() },
  handler: async (ctx, { cursor, limit }) => {
    const result = await ctx.db
      .query("skills")
      .withIndex("by_needsTagging", (q) => q.eq("needsTagging", true))
      .paginate({ numItems: limit, cursor: cursor ?? null });
    return {
      skills: result.page.map((s) => ({
        id: s._id,
        name: s.name,
        description: s.description,
        // Cut here, not in the action, so a batch doesn't ship 25 whole
        // SKILL.md bodies to keep the first few KB of each.
        content: s.content?.slice(0, SKILL_CONTENT_CHARS),
        contentUpdatedAt: s.contentUpdatedAt,
      })),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

const categorizationValidator = v.object({
  scores: v.record(v.string(), v.number()),
  primary: v.optional(v.string()),
  primaryConfidence: v.number(),
  model: v.string(),
});

/** The only writer of tags. Patches the skill and mirrors `tags` to its
 *  summary in one transaction. */
export const writeTagsBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        skillId: v.id("skills"),
        result: categorizationValidator,
        /** The row's contentUpdatedAt when it was read for tagging. */
        contentUpdatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    for (const { skillId, result, contentUpdatedAt } of entries) {
      const skill = await ctx.db.get(skillId);
      if (!skill) continue;
      const tags = deriveTags(
        result.scores,
        result.primary,
        result.primaryConfidence,
      );
      await ctx.db.patch(skillId, {
        // The file changed while Jev was answering (a content fetch landed
        // between the read and this write). Store these tags, better than
        // none, but keep the flag so the new content gets tagged too.
        needsTagging: skill.contentUpdatedAt !== contentUpdatedAt,
        tags,
        tagScores: result.scores,
        primaryCategory: result.primary,
        primaryCategoryConfidence: result.primaryConfidence,
        tagsModel: result.model,
        tagsVersion: CATEGORIES_VERSION,
        taggedAt: now,
        tagSkipReason: undefined,
      });
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", skill.source).eq("skillId", skill.skillId),
        )
        .unique();
      if (summary) await ctx.db.patch(summary._id, { tags });
    }
  },
});

/** Stop retrying a skill Jev refuses. Its previous tags, if any, stay. */
export const markSkillUntaggable = internalMutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    if (!(await ctx.db.get(skillId))) return;
    await ctx.db.patch(skillId, {
      needsTagging: false,
      tagSkipReason: "input_rejected",
    });
  },
});

export const tagSkillsBatch = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<void> => {
    // Dev deployments without a key must not fail the content chain that
    // scheduled this. The flags stay set, so adding the key later picks the
    // backlog up on the next run.
    if (!hasTypeSafeKey()) {
      console.log("tagSkillsBatch: TYPESAFE_API_KEY not set, skipping");
      return;
    }

    const result: {
      skills: Array<{
        id: Id<"skills">;
        name: string;
        description?: string;
        content?: string;
        contentUpdatedAt?: number;
      }>;
      nextCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.tags.listSkillsNeedingTagging, {
      cursor,
      limit: TAG_BATCH_SIZE,
    });

    const settled = await Promise.allSettled(
      result.skills.map((s) => categorizeSkill(s)),
    );

    const entries: Array<{
      skillId: Id<"skills">;
      result: SkillCategorization;
      contentUpdatedAt?: number;
    }> = [];
    const failures: unknown[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      const skill = result.skills[i];
      if (outcome.status === "fulfilled") {
        entries.push({
          skillId: skill.id,
          result: outcome.value,
          contentUpdatedAt: skill.contentUpdatedAt,
        });
      } else if (outcome.reason instanceof TaggingInputRejectedError) {
        console.warn(
          `Jev rejected skill ${skill.id}, marking untaggable: ${outcome.reason.message}`,
        );
        await ctx.runMutation(internal.tags.markSkillUntaggable, {
          skillId: skill.id,
        });
      } else {
        failures.push(outcome.reason);
      }
    }

    if (entries.length > 0) {
      await ctx.runMutation(internal.tags.writeTagsBatch, { entries });
      console.log(`Tagged ${entries.length}/${result.skills.length} skills`);
    }

    // Other errors have already been retried by the SDK (429/529, timeouts).
    // A whole batch failing means the service is down: stop, and let the next
    // content chain resume. A partial failure keeps going, or one skill that
    // always errors would sit at the head of the index and stop every chain
    // after one batch. Its flag stays set, so later chains retry it.
    if (failures.length > 0) {
      console.error(
        `Tagging failed for ${failures.length}/${result.skills.length} skills:`,
        failures[0],
      );
      if (failures.length === result.skills.length) return;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        TAG_CHAIN_DELAY_MS,
        internal.tags.tagSkillsBatch,
        { cursor: result.nextCursor },
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Re-tagging after a definitions change. Permanent, not a one-shot repair:
// the definitions will keep being tuned, and each bump of CATEGORIES_VERSION
// needs the same two commands.
//
//   npx convex run tags:markAllForTagging [--prod]
//   npx convex run tags:tagSkillsBatch [--prod]
//
// The first flags every live skill, one page per scheduled call, and starts
// the tagging chain itself when it reaches the end. The second is only needed
// to restart a chain that stopped on an error. The first run of the first
// command on each deployment is also the initial backfill.
// ---------------------------------------------------------------------------

// Skills rows average ~10 KB (schema.ts), so a page is ~2 MB of reads, well
// inside one mutation's read limit.
const MARK_PAGE_SIZE = 200;

export const markAllForTagging = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    // Flag only this many skills, to try a definitions change on a sample
    // before paying for the whole catalog: '{"limit": 200}'.
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, limit }) => {
    const page = await ctx.db
      .query("skills")
      .withIndex("by_isDelisted", (q) => q.eq("isDelisted", false))
      .paginate({
        numItems: Math.min(MARK_PAGE_SIZE, limit ?? MARK_PAGE_SIZE),
        cursor: cursor ?? null,
      });
    for (const skill of page.page) {
      if (!skill.needsTagging) {
        await ctx.db.patch(skill._id, { needsTagging: true });
      }
    }
    const remaining =
      limit === undefined ? undefined : limit - page.page.length;
    if (page.isDone || (remaining !== undefined && remaining <= 0)) {
      await ctx.scheduler.runAfter(0, internal.tags.tagSkillsBatch, {});
    } else {
      await ctx.scheduler.runAfter(0, internal.tags.markAllForTagging, {
        cursor: page.continueCursor,
        limit: remaining,
      });
    }
  },
});

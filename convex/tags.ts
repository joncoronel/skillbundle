/**
 * Category tagging: the `needsTagging` work-set, drained by `tagSkillsBatch`.
 * Flagged and scheduled alongside embeddings; see docs/skill-lifecycle.md
 * "Category tagging". Two chains can overlap and tag a skill twice, which
 * costs a fraction of a cent, so there is no lock.
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

// Constants, not args: scheduled calls capture their args (see
// EMBED_BATCH_SIZE in skills.ts). 25 parallel requests per 1.5s stays under
// Jev's 1,200 requests/minute.
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
        // Cut here so a batch doesn't ship 25 whole SKILL.md bodies.
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

/** The only writer of tagging results. An entry without `result` is a skill
 *  Jev refused (400/422): parked with `tagSkipReason`, old tags kept. */
export const writeTagsBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        skillId: v.id("skills"),
        result: v.optional(categorizationValidator),
        contentUpdatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    for (const { skillId, result, contentUpdatedAt } of entries) {
      const skill = await ctx.db.get(skillId);
      if (!skill) continue;
      // Content changed while Jev was answering: keep the flag so the new
      // content gets its own attempt.
      const needsTagging = skill.contentUpdatedAt !== contentUpdatedAt;
      if (!result) {
        await ctx.db.patch(skillId, {
          needsTagging,
          tagSkipReason: "input_rejected",
        });
        continue;
      }
      const tags = deriveTags(
        result.scores,
        result.primary,
        result.primaryConfidence,
      );
      await ctx.db.patch(skillId, {
        needsTagging,
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

export const tagSkillsBatch = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<void> => {
    // No key (e.g. a dev deployment): skip without failing the content chain.
    // Flags stay set, so a key added later picks up the backlog.
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
      result?: SkillCategorization;
      contentUpdatedAt?: number;
    }> = [];
    let rejected = 0;
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
        entries.push({
          skillId: skill.id,
          contentUpdatedAt: skill.contentUpdatedAt,
        });
        rejected++;
      } else {
        failures.push(outcome.reason);
      }
    }

    if (entries.length > 0) {
      await ctx.runMutation(internal.tags.writeTagsBatch, { entries });
      console.log(
        `Tagged ${entries.length - rejected}/${result.skills.length} skills (${rejected} rejected)`,
      );
    }

    // The SDK has already retried these. Only a fully failed batch (service
    // down) stops the chain; stopping on a partial one would let a single
    // always-failing skill at the head of the index stall every run.
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

// Backfill and re-tag after a definitions change (permanent, not a one-shot
// repair): `npx convex run tags:markAllForTagging [--prod]` flags every live
// skill, then starts the tagging chain. `tags:tagSkillsBatch` restarts a
// chain that stopped.

// ~10 KB skills rows, so ~2 MB per page: inside one mutation's read limit.
const MARK_PAGE_SIZE = 200;

export const markAllForTagging = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    // Flag only this many, to try a definitions change on a sample first.
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

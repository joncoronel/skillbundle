/**
 * Read API over the skill version archive.
 *
 * Public and unauthenticated on purpose. Version history is a CATALOG feature
 * first — it is one of the few things a skill's page here can show that
 * skills.sh's cannot — and only secondarily the substrate for a watchlist's
 * "what changed" view. Gating it behind sign-in would hide the differentiator
 * from exactly the people arriving via search.
 *
 * ## Why nothing here returns file contents
 *
 * `ctx.storage.get()` (which reads bytes) is action-only in Convex; queries get
 * `ctx.storage.getUrl()`, which hands back a URL. That constraint happens to
 * produce the architecture you would want anyway: content never passes through a
 * query, so the browser (or a cached server component) fetches each version
 * straight from storage and the function pays no egress for a 15 KB file.
 *
 * It also suits the renderer. `@pierre/diffs` computes diffs client-side from
 * two full contents via `parseDiffFromFile(old, new)`, so the caller's job is to
 * fetch two URLs and hand over the strings. Nothing needs a patch computed
 * server-side, which is why none is stored — see the schema comment on
 * `skillVersions`.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

/**
 * Timeline page size. Generous because entries are small and the common skill
 * has a handful of versions a year (~27% of the catalog changes per month, so a
 * typical row moves a few times annually). Active skills accumulate faster, so
 * this caps rather than assumes.
 */
const DEFAULT_VERSION_LIMIT = 50;
const MAX_VERSION_LIMIT = 200;

/** Metadata shape shared by the timeline and the dashboard feed. */
const versionEntry = v.object({
  versionId: v.id("skillVersions"),
  changedAt: v.number(),
  syncHash: v.string(),
  previousSyncHash: v.optional(v.string()),
  frontmatterVersion: v.optional(v.string()),
  previousFrontmatterVersion: v.optional(v.string()),
  descriptionBefore: v.optional(v.string()),
  descriptionAfter: v.optional(v.string()),
  descriptionChanged: v.boolean(),
  contentChanged: v.boolean(),
  isBaseline: v.boolean(),
  rawBytes: v.number(),
  /**
   * Direct storage URL for this version's raw SKILL.md, frontmatter included.
   * Null if the blob has been removed. Callers fetch it themselves; see the
   * module header for why it is a URL rather than a string of content.
   */
  contentUrl: v.union(v.string(), v.null()),
});

async function toEntry(ctx: QueryCtx, row: Doc<"skillVersions">) {
  return {
    versionId: row._id,
    changedAt: row.changedAt,
    syncHash: row.syncHash,
    previousSyncHash: row.previousSyncHash,
    frontmatterVersion: row.frontmatterVersion,
    previousFrontmatterVersion: row.previousFrontmatterVersion,
    descriptionBefore: row.descriptionBefore,
    descriptionAfter: row.descriptionAfter,
    descriptionChanged: row.descriptionChanged,
    contentChanged: row.contentChanged,
    isBaseline: row.isBaseline,
    rawBytes: row.rawBytes,
    contentUrl: await ctx.storage.getUrl(row.rawStorageId),
  };
}

/** Resolve source+skillId through the ~200 B summary, not the ~13 KB skills row. */
async function resolveSkillDocId(
  ctx: QueryCtx,
  source: string,
  skillId: string,
): Promise<Id<"skills"> | null> {
  const summary = await ctx.db
    .query("skillSummaries")
    .withIndex("by_source_skillId", (q) =>
      q.eq("source", source).eq("skillId", skillId),
    )
    .unique();
  return summary?.skillDocId ?? null;
}

/**
 * One skill's change timeline, newest first.
 *
 * An empty array is an ordinary, expected result, not an error: the archive only
 * began recording in Aug 2026, and a skill that has not changed since then has
 * no rows at all. The UI must read that as "no changes recorded yet" rather than
 * "no history exists", because the two look identical here and mean different
 * things to a reader.
 */
export const listForSkill = query({
  args: {
    source: v.string(),
    skillId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(versionEntry),
  handler: async (ctx, { source, skillId, limit }) => {
    const skillDocId = await resolveSkillDocId(ctx, source, skillId);
    if (!skillDocId) return [];

    const take = Math.min(limit ?? DEFAULT_VERSION_LIMIT, MAX_VERSION_LIMIT);
    const rows = await ctx.db
      .query("skillVersions")
      .withIndex("by_skill_changedAt", (q) => q.eq("skillDocId", skillDocId))
      .order("desc")
      .take(take);

    return await Promise.all(rows.map((row) => toEntry(ctx, row)));
  },
});

/**
 * Fetch specific versions by id, for the diff view.
 *
 * Takes a list rather than a pair so one round trip serves both the adjacent
 * case (v3 vs v4) and the cumulative one (v2 vs v5, "everything since I added
 * this"), which is the comparison that actually justifies the feature.
 *
 * Returns in the order requested, skipping ids that no longer resolve.
 */
export const getVersions = query({
  args: { versionIds: v.array(v.id("skillVersions")) },
  returns: v.array(versionEntry),
  handler: async (ctx, { versionIds }) => {
    // Bounded so a crafted client can't ask for the whole archive in one call.
    const ids = versionIds.slice(0, MAX_VERSION_LIMIT);
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return await Promise.all(
      rows.filter((r): r is Doc<"skillVersions"> => r !== null).map((r) =>
        toEntry(ctx, r),
      ),
    );
  },
});

/**
 * Current security verdict plus the one it replaced, for the skill page.
 *
 * Kept separate from the version timeline rather than merged into it. Both are
 * "things that happened to this skill", but audits retain only current and
 * previous (no timeline), so interleaving them would imply a completeness the
 * data does not have. Presenting them together is a layout decision for the UI,
 * which can make it honestly; doing it here would bake in a false shape.
 */
export const getAuditChange = query({
  args: { source: v.string(), skillId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      worstStatus: v.string(),
      worstRiskLevel: v.optional(v.string()),
      previousWorstStatus: v.optional(v.string()),
      previousWorstRiskLevel: v.optional(v.string()),
      worstStatusChangedAt: v.optional(v.number()),
      fetchedAt: v.number(),
      /**
       * The verdict got worse, not merely different. `pass → warn` and
       * `warn → fail` are the cases worth surfacing prominently; `fail → pass`
       * is good news and should not wear the same treatment.
       */
      regressed: v.boolean(),
    }),
  ),
  handler: async (ctx, { source, skillId }) => {
    const row = await ctx.db
      .query("skillAudits")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!row) return null;

    const rank: Record<string, number> = {
      unknown: 0,
      pass: 1,
      warn: 2,
      fail: 3,
    };
    const previous = row.previousWorstStatus;
    const regressed =
      previous !== undefined &&
      (rank[row.worstStatus] ?? 0) > (rank[previous] ?? 0);

    return {
      worstStatus: row.worstStatus,
      worstRiskLevel: row.worstRiskLevel,
      previousWorstStatus: row.previousWorstStatus,
      previousWorstRiskLevel: row.previousWorstRiskLevel,
      worstStatusChangedAt: row.worstStatusChangedAt,
      fetchedAt: row.fetchedAt,
      regressed,
    };
  },
});

/**
 * The dashboard feed: skills across the signed-in user's bundles that changed
 * since they last opened the bundle holding them, newest first.
 *
 * Runs the cheap direction — user → their bundles → those skills → latest
 * version — which is why no inverted skill-to-watcher index exists. An earlier
 * design built one; it turned out to be needed only for pushing email, and there
 * is no email.
 *
 * A skill filed in two bundles appears once, attributed to whichever bundle
 * makes it unread by the wider margin (the earliest baseline), so the feed
 * reflects the longest you have gone without seeing it.
 */
export const listRecentChangesForUser = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      source: v.string(),
      skillId: v.string(),
      name: v.string(),
      bundleId: v.id("bundles"),
      bundleName: v.string(),
      bundleUrlId: v.string(),
      latest: versionEntry,
    }),
  ),
  handler: async (ctx, { limit }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const bundles = await ctx.db
      .query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();

    // key -> the bundle context with the EARLIEST baseline, so a skill in two
    // bundles is reported against the one it has been unread in longest.
    const candidates = new Map<
      string,
      { bundle: Doc<"bundles">; source: string; skillId: string; baseline: number }
    >();

    for (const bundle of bundles) {
      for (const s of bundle.skills) {
        const baseline = Math.max(bundle.lastViewedAt ?? 0, s.addedAt ?? 0);
        const key = `${s.source}::${s.skillId}`;
        const existing = candidates.get(key);
        if (!existing || baseline < existing.baseline) {
          candidates.set(key, {
            bundle,
            source: s.source,
            skillId: s.skillId,
            baseline,
          });
        }
      }
    }

    const results = await Promise.all(
      Array.from(candidates.values()).map(async (c) => {
        const summary = await ctx.db
          .query("skillSummaries")
          .withIndex("by_source_skillId", (q) =>
            q.eq("source", c.source).eq("skillId", c.skillId),
          )
          .unique();
        if (!summary) return null;

        // Cheap rejection first: the mirrored timestamp answers "did anything
        // change?" from a ~200 B row, so only genuinely-unread skills go on to
        // touch the archive.
        const updated = summary.contentUpdatedAt;
        if (updated === undefined || updated <= c.baseline) return null;

        const latest = await ctx.db
          .query("skillVersions")
          .withIndex("by_skill_changedAt", (q) =>
            q.eq("skillDocId", summary.skillDocId),
          )
          .order("desc")
          .first();
        // Changed before the archive existed, or archiving failed for it. The
        // count and the feed can legitimately disagree here; the feed only shows
        // what it can actually render a diff for.
        if (!latest) return null;

        return {
          source: c.source,
          skillId: c.skillId,
          name: summary.name,
          bundleId: c.bundle._id,
          bundleName: c.bundle.name,
          bundleUrlId: c.bundle.urlId,
          latest: await toEntry(ctx, latest),
        };
      }),
    );

    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.latest.changedAt - a.latest.changedAt)
      .slice(0, Math.min(limit ?? DEFAULT_VERSION_LIMIT, MAX_VERSION_LIMIT));
  },
});

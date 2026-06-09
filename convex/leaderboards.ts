/**
 * Trending + Hot leaderboard sync.
 *
 * Refreshes the `trendingRank` field (1..N) and the hot-view fields
 * (`hotChange`, `hotInstallsYesterday`) on `skills` and `skillSummaries`
 * from the v1 listing endpoint. Cards on the home page render directly
 * from the denormalized fields — no second query at render time.
 *
 * Reconciliation strategy: walk what the API returned and stamp ranks
 * onto matching rows; for rows that previously had a rank/hot value but
 * are no longer in the leaderboard, clear the field.
 */

import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  listSkills as v1ListSkills,
  SkillsApiRateLimitError,
} from "./lib/skillsApi";
import { revalidateHomeTag } from "./lib/revalidate";

const TRENDING_LIMIT = 200; // top N to track
const HOT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Trending
// ---------------------------------------------------------------------------

export const syncTrending = internalAction({
  args: {},
  handler: async (ctx) => {
    let response;
    try {
      response = await v1ListSkills({
        view: "trending",
        page: 0,
        perPage: TRENDING_LIMIT,
      });
    } catch (e) {
      if (e instanceof SkillsApiRateLimitError) {
        await ctx.scheduler.runAfter(
          e.retryAfterSeconds * 1000,
          internal.leaderboards.syncTrending,
          {},
        );
        return;
      }
      console.error("syncTrending failed:", e);
      return;
    }

    // `installs` in the trending view is the windowed (~24h) install count the
    // view is ranked by, NOT lifetime — keep it to show on the Trending tab.
    const ranked = response.data.map((s, i) => ({
      source: s.source,
      skillId: s.slug,
      trendingRank: i + 1,
      trendingInstalls: s.installs,
    }));

    await ctx.runMutation(internal.leaderboards.applyTrending, { ranked });
    await revalidateHomeTag("home-trending");
  },
});

export const applyTrending = internalMutation({
  args: {
    ranked: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        trendingRank: v.number(),
        trendingInstalls: v.number(),
      }),
    ),
  },
  handler: async (ctx, { ranked }) => {
    const seen = new Set<string>();
    let stamped = 0;
    let cleared = 0;

    // Stamp current ranks.
    for (const entry of ranked) {
      const key = `${entry.source}|${entry.skillId}`;
      seen.add(key);

      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", entry.source).eq("skillId", entry.skillId),
        )
        .unique();
      if (!summary) continue;

      if (
        summary.trendingRank !== entry.trendingRank ||
        summary.trendingInstalls !== entry.trendingInstalls
      ) {
        const fields = {
          trendingRank: entry.trendingRank,
          trendingInstalls: entry.trendingInstalls,
        };
        await ctx.db.patch(summary._id, fields);
        await ctx.db.patch(summary.skillDocId, fields);
        stamped++;
      }
    }

    // Clear ranks from rows that fell off the leaderboard. The range
    // `gt("trendingRank", 0)` is critical: Convex orders undefined < numbers,
    // so without it the walk reads ~75k undefined rows before reaching any
    // ranked rows. With it, the walk reads only the ~200 currently-ranked rows.
    const previouslyRanked = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_trendingRank", (q) =>
        q.eq("isDelisted", false).gt("trendingRank", 0),
      )
      .collect();

    for (const summary of previouslyRanked) {
      const key = `${summary.source}|${summary.skillId}`;
      if (!seen.has(key)) {
        const clearedFields = {
          trendingRank: undefined,
          trendingInstalls: undefined,
        };
        await ctx.db.patch(summary._id, clearedFields);
        await ctx.db.patch(summary.skillDocId, clearedFields);
        cleared++;
      }
    }

    console.log(`syncTrending: stamped ${stamped}, cleared ${cleared}`);
  },
});

// ---------------------------------------------------------------------------
// Hot
// ---------------------------------------------------------------------------

export const syncHot = internalAction({
  args: {},
  handler: async (ctx) => {
    let response;
    try {
      response = await v1ListSkills({
        view: "hot",
        page: 0,
        perPage: HOT_LIMIT,
      });
    } catch (e) {
      if (e instanceof SkillsApiRateLimitError) {
        await ctx.scheduler.runAfter(
          e.retryAfterSeconds * 1000,
          internal.leaderboards.syncHot,
          {},
        );
        return;
      }
      console.error("syncHot failed:", e);
      return;
    }

    // Preserve the API's order as hotRank (1..N). The v1 "hot" view ranks by
    // current-hour install volume, NOT by `change` — `change` is the day-over-
    // day delta (current-hour installs minus the same hour yesterday) and is
    // frequently negative even for the hottest skills. We mirror the API's
    // ranking (like trending) so our Hot tab matches skills.sh; `change` is
    // kept only to drive the momentum chip.
    const ranked = response.data.map((s, i) => ({
      source: s.source,
      skillId: s.slug,
      hotRank: i + 1,
      hotChange: s.change ?? 0,
      hotInstallsYesterday: s.installsYesterday ?? 0,
    }));

    await ctx.runMutation(internal.leaderboards.applyHot, { ranked });
    await revalidateHomeTag("home-hot");
  },
});

export const applyHot = internalMutation({
  args: {
    ranked: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        hotRank: v.number(),
        hotChange: v.number(),
        hotInstallsYesterday: v.number(),
      }),
    ),
  },
  handler: async (ctx, { ranked }) => {
    const seen = new Set<string>();
    let stamped = 0;
    let cleared = 0;

    for (const entry of ranked) {
      const key = `${entry.source}|${entry.skillId}`;
      seen.add(key);

      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", entry.source).eq("skillId", entry.skillId),
        )
        .unique();
      if (!summary) continue;

      if (
        summary.hotRank !== entry.hotRank ||
        summary.hotChange !== entry.hotChange ||
        summary.hotInstallsYesterday !== entry.hotInstallsYesterday
      ) {
        const fields = {
          hotRank: entry.hotRank,
          hotChange: entry.hotChange,
          hotInstallsYesterday: entry.hotInstallsYesterday,
        };
        await ctx.db.patch(summary._id, fields);
        await ctx.db.patch(summary.skillDocId, fields);
        stamped++;
      }
    }

    // Clear hot fields from rows that fell off the leaderboard. hotRank is set
    // on exactly the rows currently in the hot view, so a single walk of the
    // rank index (gt(0) to skip the undefined majority) finds them all — no
    // need to union multiple indices.
    const previouslyHot = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_hotRank", (q) =>
        q.eq("isDelisted", false).gt("hotRank", 0),
      )
      .collect();

    for (const summary of previouslyHot) {
      const key = `${summary.source}|${summary.skillId}`;
      if (!seen.has(key)) {
        const clearedFields = {
          hotRank: undefined,
          hotChange: undefined,
          hotInstallsYesterday: undefined,
        };
        await ctx.db.patch(summary._id, clearedFields);
        await ctx.db.patch(summary.skillDocId, clearedFields);
        cleared++;
      }
    }

    console.log(`syncHot: stamped ${stamped}, cleared ${cleared}`);
  },
});

// ---------------------------------------------------------------------------
// One-time migration (safe to delete once run in production)
// ---------------------------------------------------------------------------

/**
 * One-time hygiene scan that clears hot fields from any row that shouldn't
 * carry them. Two classes:
 *  - Pre-migration orphans: had hotChange/hotInstallsYesterday set before
 *    hotRank existed, so they have no rank and the new applyHot cleanup (which
 *    walks by_isDelisted_hotRank) can't find them.
 *  - Delisted-but-hot: rows delisted while hot before the delist path learned
 *    to clear hotRank — invisible while delisted, but a stale rank could
 *    briefly surface if they relist.
 * A row legitimately keeps hot fields only while it's a live member of the hot
 * view (non-delisted + ranked); everything else is cleared. Full table scan
 * (hot fields aren't broadly indexed); one-time. Run once:
 *   npx convex run leaderboards:clearStaleHotFields --prod
 */
export const clearStaleHotFields = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let isDone = false;
    let cleared = 0;
    let scanned = 0;

    while (!isDone) {
      const res: {
        cursor: string;
        isDone: boolean;
        cleared: number;
        scanned: number;
      } = await ctx.runMutation(
        internal.leaderboards.clearStaleHotFieldsBatch,
        { cursor },
      );
      cursor = res.cursor;
      isDone = res.isDone;
      cleared += res.cleared;
      scanned += res.scanned;
    }

    console.log(
      `clearStaleHotFields: cleared ${cleared} orphan rows (scanned ${scanned})`,
    );
  },
});

export const clearStaleHotFieldsBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 500, cursor });

    let cleared = 0;
    for (const s of page.page) {
      const hasHotFields =
        s.hotRank !== undefined ||
        s.hotChange !== undefined ||
        s.hotInstallsYesterday !== undefined;
      // A row should carry hot fields only while it's a live member of the hot
      // view: non-delisted with a rank. Clear everything else — pre-migration
      // orphans (fields, no rank) and delisted-but-hot rows (rank that outlived
      // a delist).
      const isCurrentlyHot = s.isDelisted === false && s.hotRank !== undefined;
      if (hasHotFields && !isCurrentlyHot) {
        const clearedFields = {
          hotRank: undefined,
          hotChange: undefined,
          hotInstallsYesterday: undefined,
        };
        await ctx.db.patch(s._id, clearedFields);
        await ctx.db.patch(s.skillDocId, clearedFields);
        cleared++;
      }
    }

    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      cleared,
      scanned: page.page.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Public queries — Home page tabs
// ---------------------------------------------------------------------------

/**
 * Trending tab: walk by trendingRank ascending, filtered to non-delisted.
 * Most rows have trendingRank undefined, so the index is small and selective.
 */
export const listTrending = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    // gt("trendingRank", 0) is required so the walk skips the (~75k) undefined
    // rows that come first in Convex's index ordering. Without it, the
    // pagination scans untold thousands of undefined rows before finding any
    // actual ranked ones.
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_trendingRank", (q) =>
        q.eq("isDelisted", false).gt("trendingRank", 0),
      )
      .order("asc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.filter((s) => !s.isDuplicate),
    };
  },
});

/**
 * Hot rail: top N skills in the v1 "hot" view, which ranks by current-hour
 * install volume (mirrored into hotRank). NOT filtered by `change` — the
 * hottest skills frequently have a negative hour-over-hour delta, so a
 * positive-only filter would (and did) leave the rail empty. Small enough to
 * return in one shot.
 */
export const listHot = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // Walk by hotRank ascending; gt("hotRank", 0) skips the undefined majority
    // that sorts first in Convex's index order. The index holds at most
    // HOT_LIMIT ranked rows, so this is cheap.
    const rows = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_hotRank", (q) =>
        q.eq("isDelisted", false).gt("hotRank", 0),
      )
      .order("asc")
      .take(limit ?? 10);

    return rows.filter((s) => !s.isDuplicate);
  },
});

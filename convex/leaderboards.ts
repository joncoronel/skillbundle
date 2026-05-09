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

    const ranked = response.data.map((s, i) => ({
      source: s.source,
      skillId: s.slug,
      trendingRank: i + 1,
    }));

    await ctx.runMutation(internal.leaderboards.applyTrending, { ranked });
  },
});

export const applyTrending = internalMutation({
  args: {
    ranked: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        trendingRank: v.number(),
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

      if (summary.trendingRank !== entry.trendingRank) {
        await ctx.db.patch(summary._id, { trendingRank: entry.trendingRank });
        await ctx.db.patch(summary.skillDocId, {
          trendingRank: entry.trendingRank,
        });
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
        await ctx.db.patch(summary._id, { trendingRank: undefined });
        await ctx.db.patch(summary.skillDocId, { trendingRank: undefined });
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

    const ranked = response.data.map((s) => ({
      source: s.source,
      skillId: s.slug,
      hotChange: s.change ?? 0,
      hotInstallsYesterday: s.installsYesterday ?? 0,
    }));

    await ctx.runMutation(internal.leaderboards.applyHot, { ranked });
  },
});

export const applyHot = internalMutation({
  args: {
    ranked: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
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
        summary.hotChange !== entry.hotChange ||
        summary.hotInstallsYesterday !== entry.hotInstallsYesterday
      ) {
        await ctx.db.patch(summary._id, {
          hotChange: entry.hotChange,
          hotInstallsYesterday: entry.hotInstallsYesterday,
        });
        await ctx.db.patch(summary.skillDocId, {
          hotChange: entry.hotChange,
          hotInstallsYesterday: entry.hotInstallsYesterday,
        });
        stamped++;
      }
    }

    // Clear hot fields from rows that fell off. Walk the by_isDelisted_hotChange
    // index with a positive-only range so we skip the ~75k rows where
    // hotChange is undefined.
    const previouslyHot = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_hotChange", (q) =>
        q.eq("isDelisted", false).gt("hotChange", 0),
      )
      .collect();

    for (const summary of previouslyHot) {
      const key = `${summary.source}|${summary.skillId}`;
      if (!seen.has(key)) {
        await ctx.db.patch(summary._id, {
          hotChange: undefined,
          hotInstallsYesterday: undefined,
        });
        await ctx.db.patch(summary.skillDocId, {
          hotChange: undefined,
          hotInstallsYesterday: undefined,
        });
        cleared++;
      }
    }

    console.log(`syncHot: stamped ${stamped}, cleared ${cleared}`);
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
 * Hot rail: top ~10 most-spiking skills by hour-over-hour install delta.
 * Small enough to return in one shot.
 */
export const listHot = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // Walk the dedicated by_isDelisted_hotChange index with a positive-only
    // range so we skip every row where hotChange is undefined. After the
    // range, we have at most ~50 rows (HOT_LIMIT), so the in-memory sort is
    // cheap. Order desc inside the index walk so the slice is the top N.
    const rows = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_hotChange", (q) =>
        q.eq("isDelisted", false).gt("hotChange", 0),
      )
      .order("desc")
      .take(limit ?? 10);

    return rows.filter((s) => !s.isDuplicate);
  },
});

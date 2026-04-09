import {
  mutation,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getCurrentUser } from "./users";
import { enrichBundle } from "./bundles";

// ---------------------------------------------------------------------------
// Record events
// ---------------------------------------------------------------------------

export const recordEvent = mutation({
  args: {
    bundleId: v.id("bundles"),
    eventType: v.union(
      v.literal("view"),
      v.literal("copy"),
      v.literal("fork"),
    ),
  },
  handler: async (ctx, { bundleId, eventType }) => {
    const user = await getCurrentUser(ctx);
    const now = Date.now();

    // Deduplicate view events: 1 per user (or anon) per bundle per hour
    if (eventType === "view") {
      const oneHourAgo = now - 60 * 60 * 1000;
      const recentView = await ctx.db
        .query("bundleEvents")
        .withIndex("by_bundle_createdAt", (q) =>
          q.eq("bundleId", bundleId).gte("createdAt", oneHourAgo),
        )
        .filter((q) => q.eq(q.field("eventType"), "view"))
        .first();

      if (recentView) {
        if (!user && !recentView.userId) return;
        if (user && recentView.userId === user._id) return;
      }
    }

    // Insert the raw event
    await ctx.db.insert("bundleEvents", {
      bundleId,
      eventType,
      userId: user?._id,
      createdAt: now,
    });

    // Upsert materialized stats
    const existing = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();

    if (existing) {
      const update: Record<string, number> = { lastEventAt: now };
      if (eventType === "view") update.viewCount = existing.viewCount + 1;
      if (eventType === "copy") {
        update.copyCount = existing.copyCount + 1;
        update.recentCopyCount = existing.recentCopyCount + 1;
      }
      if (eventType === "fork") update.forkCount = existing.forkCount + 1;
      await ctx.db.patch(existing._id, update);
    } else {
      await ctx.db.insert("bundleStats", {
        bundleId,
        viewCount: eventType === "view" ? 1 : 0,
        copyCount: eventType === "copy" ? 1 : 0,
        forkCount: eventType === "fork" ? 1 : 0,
        recentCopyCount: eventType === "copy" ? 1 : 0,
        lastEventAt: now,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Trending bundles query
// ---------------------------------------------------------------------------

export const getTrendingBundles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 6 }) => {
    const stats = await ctx.db
      .query("bundleStats")
      .withIndex("by_recentCopies")
      .order("desc")
      .take(limit);

    // Fetch all bundle docs in parallel
    const bundles = await Promise.all(
      stats.map((stat) => ctx.db.get(stat.bundleId)),
    );

    // Filter to public bundles and pair with stats
    const candidates = stats
      .map((stat, i) => ({ stat, bundle: bundles[i] }))
      .filter(
        (entry): entry is { stat: (typeof stats)[0]; bundle: NonNullable<(typeof bundles)[0]> } =>
          entry.bundle !== null && entry.bundle.isPublic,
      );

    // Enrich all candidates in parallel
    const enriched = await Promise.all(
      candidates.map(async ({ stat, bundle }) => {
        const data = await enrichBundle(ctx, bundle);
        return { ...data, copyCount: stat.copyCount, viewCount: stat.viewCount, forkCount: stat.forkCount };
      }),
    );

    return enriched;
  },
});

// ---------------------------------------------------------------------------
// Stats for a single bundle
// ---------------------------------------------------------------------------

export const getStatsForBundle = query({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const stats = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();

    return stats ?? { viewCount: 0, copyCount: 0, forkCount: 0, recentCopyCount: 0 };
  },
});

// ---------------------------------------------------------------------------
// Recalculate recent copy counts (called by weekly cron)
// ---------------------------------------------------------------------------

export const listStatsBatch = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const paginationOpts = cursor
      ? { numItems: 100, cursor }
      : { numItems: 100, cursor: null };
    const result = await ctx.db.query("bundleStats").paginate(paginationOpts);
    return {
      ids: result.page.map((s) => s._id),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const recalculateRecentCopyCountsBatch = internalMutation({
  args: { statIds: v.array(v.id("bundleStats")) },
  handler: async (ctx, { statIds }) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const statId of statIds) {
      const stat = await ctx.db.get(statId);
      if (!stat) continue;

      const recentEvents = await ctx.db
        .query("bundleEvents")
        .withIndex("by_bundle_createdAt", (q) =>
          q.eq("bundleId", stat.bundleId).gte("createdAt", sevenDaysAgo),
        )
        .collect();

      const recentCopyCount = recentEvents.filter(
        (e) => e.eventType === "copy",
      ).length;

      if (recentCopyCount !== stat.recentCopyCount) {
        await ctx.db.patch(stat._id, { recentCopyCount });
      }
    }
  },
});

export const recalculateRecentCopyCounts = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | undefined;
    let isDone = false;

    while (!isDone) {
      const result = await ctx.runQuery(
        internal.bundleEvents.listStatsBatch,
        { cursor },
      );

      if (result.ids.length > 0) {
        await ctx.runMutation(
          internal.bundleEvents.recalculateRecentCopyCountsBatch,
          { statIds: result.ids },
        );
      }

      cursor = result.nextCursor;
      isDone = result.isDone;
    }
  },
});

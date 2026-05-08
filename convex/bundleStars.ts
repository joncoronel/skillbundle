import {
  internalAction,
  internalMutation,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getCurrentUserOrThrow } from "./users";

// ---------------------------------------------------------------------------
// Toggle a star on a bundle (idempotent)
// ---------------------------------------------------------------------------

export const toggleStar = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    // user, bundle, and stats are all independent of each other — parallelize.
    // The existing-star lookup needs user._id so it stays serial after.
    const [user, bundle, stats] = await Promise.all([
      getCurrentUserOrThrow(ctx),
      ctx.db.get(bundleId),
      ctx.db
        .query("bundleStats")
        .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
        .unique(),
    ]);

    if (!bundle) throw new Error("Bundle not found");

    const existing = await ctx.db
      .query("bundleStars")
      .withIndex("by_user_bundle", (q) =>
        q.eq("userId", user._id).eq("bundleId", bundleId),
      )
      .unique();

    // Allow unstarring (existing → delete) regardless of visibility, so a user
    // who starred while public can recover state if it later flips private.
    // Block new stars on private bundles to prevent leaderboard pre-staging.
    if (!existing && !bundle.isPublic) {
      throw new Error("Cannot star a private bundle");
    }

    const now = Date.now();

    if (existing) {
      // Unstar
      await ctx.db.delete(existing._id);
      if (stats) {
        await ctx.db.patch(stats._id, {
          starCount: Math.max(0, (stats.starCount ?? 0) - 1),
          lastEventAt: now,
        });
      }
      return { starred: false };
    }

    // Star
    await ctx.db.insert("bundleStars", {
      bundleId,
      userId: user._id,
      createdAt: now,
    });

    if (stats) {
      await ctx.db.patch(stats._id, {
        starCount: (stats.starCount ?? 0) + 1,
        lastEventAt: now,
      });
    } else {
      await ctx.db.insert("bundleStats", {
        bundleId,
        isPublic: bundle.isPublic,
        copyCount: 0,
        forkCount: 0,
        starCount: 1,
        lastEventAt: now,
      });
    }

    return { starred: true };
  },
});

// ---------------------------------------------------------------------------
// Paginated cascade: delete all bundleStars rows for a bundle.
//
// Called by `bundles.deleteBundle` via the scheduler. Lives here because
// it owns the `bundleStars` table.
//
// `bundleStars` is unbounded per bundle (one row per starring user), so the
// cascade has to be split out of the user-facing mutation — `.collect()` +
// inline delete would hit Convex's 16MB / 8K-row caps for popular bundles.
// Trade-off: brief eventual-consistency window where the bundle row is gone
// but star rows linger. No UI surfaces them by bundleId once the bundle is
// deleted, so the window is invisible to users.
//
// Failure mode: Convex retries failed scheduled jobs with exponential backoff,
// then drops them after exhaustion. If that happens, the orphan bundleStars
// rows stay forever — invisible to UI, but storage drift. If we ever observe
// real failures here, add a periodic cron that scans for stars whose
// `bundleId` no longer resolves (or pair this with a retry-counter table).
// Pre-launch / low traffic this is fine.
// ---------------------------------------------------------------------------

export const cleanupStarsForBundle = internalAction({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    while (true) {
      const { deleted }: { deleted: number } = await ctx.runMutation(
        internal.bundleStars.deleteStarBatch,
        { bundleId },
      );
      if (deleted === 0) break;
    }
  },
});

export const deleteStarBatch = internalMutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const stars = await ctx.db
      .query("bundleStars")
      .withIndex("by_bundle", (q) => q.eq("bundleId", bundleId))
      .take(500);
    for (const star of stars) await ctx.db.delete(star._id);
    return { deleted: stars.length };
  },
});

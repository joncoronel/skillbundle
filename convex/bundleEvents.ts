import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Record a copy event by incrementing the bundleStats counter inline.
//
// We don't keep a raw event log anymore — view tracking, fork events, and the
// 7-day rolling trending count were all dropped (stars + featured + newest
// already cover the discovery surface). What's left is just bumping the
// counter so we can display "N copies" on cards and the detail page.
// ---------------------------------------------------------------------------

export const recordCopy = mutation({
  args: { bundleId: v.id("bundles") },
  handler: async (ctx, { bundleId }) => {
    const bundle = await ctx.db.get(bundleId);
    if (!bundle) return;

    const now = Date.now();
    const existing = await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        copyCount: existing.copyCount + 1,
        lastEventAt: now,
      });
    } else {
      await ctx.db.insert("bundleStats", {
        bundleId,
        isPublic: bundle.isPublic,
        copyCount: 1,
        forkCount: 0,
        starCount: 0,
        lastEventAt: now,
      });
    }
  },
});


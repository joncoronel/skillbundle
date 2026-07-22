/**
 * Per-user fixed-window throttles for public actions whose work fans out to
 * external APIs.
 *
 * Motivation: the public add-skill flow resolves SKILL.md straight from
 * GitHub — repo metadata + tree listing + up to 50 raw-file downloads per
 * preview — against the same shared GitHub token budget the daily
 * discovery/sync/reconcile pipeline runs on. The GitHub-only-add quota bounds
 * WRITES, but previews are deliberately unmetered by it, so without a
 * throttle any signed-in account could loop previews across varied repos and
 * drain the hourly budget. This bounds that resolution work per user while
 * staying far above any legitimate usage.
 *
 * Fixed-window on purpose: a sliding window buys precision nobody needs here
 * (the limit is an abuse ceiling, not a fairness contract) and costs extra
 * bookkeeping. Enforcement is a mutation, so check + bump are transactional
 * and concurrent calls can't slip past the ceiling.
 */

import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
// Generous for real use (adding a handful of skills is well under ten calls)
// while capping the worst case at ~30 tree walks per user per hour.
const ADD_SKILL_LIMIT = 30;
const ADD_SKILL_KEY = "add-skill";

/**
 * Count one add-flow call (preview or confirm, either branch) against the
 * caller's hourly window. Throws a typed ConvexError when over.
 */
export const bumpAddSkillThrottle = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("userThrottles")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", ADD_SKILL_KEY),
      )
      .unique();

    if (!row) {
      await ctx.db.insert("userThrottles", {
        userId,
        key: ADD_SKILL_KEY,
        windowStart: now,
        count: 1,
      });
      return null;
    }

    if (now - row.windowStart >= WINDOW_MS) {
      await ctx.db.patch(row._id, { windowStart: now, count: 1 });
      return null;
    }

    if (row.count >= ADD_SKILL_LIMIT) {
      throw new ConvexError({
        code: "rate_limited",
        message:
          "You've made a lot of add requests in the last hour. Take a break and try again soon.",
      });
    }

    await ctx.db.patch(row._id, { count: row.count + 1 });
    return null;
  },
});

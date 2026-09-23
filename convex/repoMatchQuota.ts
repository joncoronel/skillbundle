/**
 * The free plan's repo-match allowance: FREE_MONTHLY_REPOS distinct repos per
 * UTC calendar month, per account. Pro is unlimited and demo repos are never
 * counted; which caller is metered how is `repoMatchMeter` in
 * lib/repo-match.ts. Signed-out visitors are metered separately, per IP, by
 * the `repoAnalysisAnonymous` rate limit (convex/rateLimits.ts).
 *
 * Counted at request time, cache hit or not, so what a user is told ("3 of 5
 * used") is predictable from what they did rather than from whether someone
 * else analyzed the repo first. Re-running a repo already counted this month
 * is free. A run that comes back with an error (repo not found, private
 * without access) is refunded, so a typo doesn't cost a slot; the miss is
 * charged to the daily attempt budget instead (`repoAnalysisDaily`).
 */

import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getUserPlanWithLimits } from "./lib/plans";
import {
  currentMonth,
  FREE_LIMIT,
  FREE_MONTHLY_REPOS,
} from "../lib/repo-match";

/**
 * Count `repoKey` against the caller's month. Returns true when this call
 * added it (so the caller can refund it if the run fails), false when it was
 * already counted. Throws FREE_LIMIT when the month is full.
 */
export const claim = internalMutation({
  args: { subject: v.string(), repoKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { subject, repoKey }) => {
    const month = currentMonth();
    const row = await ctx.db
      .query("repoMatchQuota")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    // A row from an earlier month is this month's empty list.
    const repos = row && row.month === month ? row.repos : [];
    if (repos.includes(repoKey)) return false;
    if (repos.length >= FREE_MONTHLY_REPOS) {
      throw new ConvexError({
        code: FREE_LIMIT,
        message: `You've matched ${FREE_MONTHLY_REPOS} repos this month, the free limit.`,
      });
    }
    const next = { month, repos: [...repos, repoKey] };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("repoMatchQuota", { subject, ...next });
    return true;
  },
});

/** Give back a slot `claim` took, for a run that produced no results. */
export const release = internalMutation({
  args: { subject: v.string(), repoKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { subject, repoKey }) => {
    const row = await ctx.db
      .query("repoMatchQuota")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (!row || row.month !== currentMonth()) return null;
    await ctx.db.patch(row._id, {
      repos: row.repos.filter((r) => r !== repoKey),
    });
    return null;
  },
});

/**
 * The caller's allowance for this month, for the "N of 5 left" line. Null when
 * nothing is metered for them: signed out (metered per IP, not per account)
 * or on Pro.
 */
export const myUsage = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      used: v.number(),
      limit: v.number(),
      repos: v.array(v.string()),
      /**
       * The month the count is for. A query only re-runs when what it read
       * changes, not when the clock moves, so a subscription opened on the
       * 31st keeps answering for that month. The client compares this with
       * its own month and treats a stale answer as a fresh month.
       */
      month: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const { limits } = await getUserPlanWithLimits(ctx);
    if (limits.canAutoDetect) return null;
    const row = await ctx.db
      .query("repoMatchQuota")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    const month = currentMonth();
    const repos = row && row.month === month ? row.repos : [];
    return { used: repos.length, limit: FREE_MONTHLY_REPOS, repos, month };
  },
});

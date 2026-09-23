/**
 * The free plan's repo-match allowance: FREE_MONTHLY_REPOS distinct repos per
 * UTC month, per account. Counted at request time, cache hit or not, so "3 of
 * 5 used" is predictable. Re-running a counted repo is free, and an errored
 * run is refunded (its miss lands on `repoAnalysisDaily` instead).
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
 * Count `repoKey` against the caller's month: true if this call added it,
 * false if already counted. Throws FREE_LIMIT when the month is full.
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

/** This month's usage for the "N of 5 left" line; null if signed out or Pro. */
export const myUsage = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      used: v.number(),
      limit: v.number(),
      repos: v.array(v.string()),
      /** Lets the client spot a stale answer after the month rolls over. */
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

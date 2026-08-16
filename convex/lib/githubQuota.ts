/**
 * GitHub-only add quota — the single home for every load-bearing agreement
 * behind "free accounts get N GitHub-only adds, Pro unlimited":
 *
 *   - the immutable `leaderboard: "github"` origin tag the insert writes and
 *     the count filters on (one constant, so a rename can't silently split
 *     inserts from counts and turn the quota off);
 *   - the bounded count (reads at most cap+1 rows — `skills` rows are ~10 KB,
 *     so an unbounded `.collect()` over a long-lived Pro account's adds would
 *     approach Convex's read ceiling);
 *   - the client-facing quota shape and the quota-exceeded error.
 *
 * Imported by `skills.ts` (the atomic gate in upsertSkillsBatch + the quota
 * queries) and `githubOnly.ts` (the public add flow).
 */

import { v, ConvexError, type Infer } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getUserPlanWithLimits } from "./plans";

/**
 * Origin tag for rows added straight from a GitHub repo. Like every other
 * `leaderboard` value it's provenance only (set on insert, never patched) —
 * which is exactly why the quota counts on it: adoption clears `isGitHubOnly`
 * but never rewrites this tag, so the lifetime count stays stable.
 */
export const GITHUB_LEADERBOARD = "github";

/** Client-facing quota status (no user id — that stays server-side). */
export const gitHubQuotaValidator = v.object({
  plan: v.union(v.literal("free"), v.literal("pro")),
  used: v.number(),
  // null = unlimited (Pro).
  limit: v.union(v.number(), v.null()),
  atLimit: v.boolean(),
});

export type GitHubAddQuotaStatus = Infer<typeof gitHubQuotaValidator>;

export function quotaExceededError(): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({
    code: "quota_exceeded",
    message:
      "You've used all your free GitHub-only skill adds. Upgrade to Pro for unlimited.",
  });
}

/**
 * Count a user's GitHub-only adds, reading at most cap+1 rows off the
 * `by_addedBy_leaderboard` index. Callers only ever compare against a cap, so
 * a bounded take keeps the read O(cap) even for an account with a long
 * Pro-era add history. MutationCtx satisfies QueryCtx, so the atomic gate in
 * upsertSkillsBatch uses this same function.
 */
export async function countGitHubOnlyAdds(
  ctx: QueryCtx,
  userId: Id<"users">,
  cap: number,
): Promise<number> {
  const rows = await ctx.db
    .query("skills")
    .withIndex("by_addedBy_leaderboard", (q) =>
      q.eq("addedBy", userId).eq("leaderboard", GITHUB_LEADERBOARD),
    )
    .take(cap + 1);
  return rows.length;
}

/**
 * Resolve a user's full quota status. Pro (limit null) skips the count
 * entirely — there's nothing to gate and nothing to display, so no reason to
 * read N heavy rows in a reactive query.
 */
export async function computeGitHubAddQuota(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<GitHubAddQuotaStatus> {
  const { plan, limits } = await getUserPlanWithLimits(ctx);
  const limit = Number.isFinite(limits.maxGitHubOnlyAdds)
    ? limits.maxGitHubOnlyAdds
    : null;
  if (limit === null) return { plan, used: 0, limit: null, atLimit: false };
  const counted = await countGitHubOnlyAdds(ctx, userId, limit);
  // Clamp the display value: a Pro-era history can exceed the free cap after
  // a downgrade, and "5 of 3 used" reads like a bug.
  return {
    plan,
    used: Math.min(counted, limit),
    limit,
    atLimit: counted >= limit,
  };
}

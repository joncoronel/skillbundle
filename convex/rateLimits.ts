/**
 * Rate limits for public actions whose work costs money or spends a shared
 * budget: GitHub resolution on the server token, Voyage embeddings, Polar API
 * calls. Built on @convex-dev/rate-limiter.
 *
 * The rule every number here follows: **a limit catches scripts, never a
 * person.** Pro is sold as unlimited, so no limit a paying user can reach by
 * using the app, even heavily, belongs here. That means:
 *
 *   - Per-user limits are per-MINUTE ceilings well above human speed, not
 *     hourly allowances. Someone importing a lot of skills in an afternoon
 *     never sees one; a loop hits it within seconds.
 *   - The only hourly per-user limit is on capped (free) accounts, which
 *     already have a plan limit and are where throwaway-account abuse comes
 *     from.
 *   - Only work that actually costs something is charged. A repo analysis
 *     served from cache is free; see recommendations.ts.
 *
 * **No app-wide limits.** There was one (`sharedGitHub`, 300 an hour across
 * all users, to protect the GitHub token the sync runs on) and it was removed
 * before launch. A limit everyone shares is itself a way to lock everyone out:
 * one Pro account at its per-user ceiling used it up in half an hour, and every
 * other paying user was then refused. Running out of GitHub budget is the
 * milder failure, since GitHub refuses for at most an hour and every caller
 * already degrades on that. Abuse spread across many accounts belongs to sign-up
 * bot protection, and isolating the sync's budget belongs to a separate token
 * (TODO.md), not to a shared counter here.
 *
 * Token buckets rather than fixed windows: a fixed window without a `start`
 * gets a random boundary per key, and a burst straddling it gets double the
 * allowance. A bucket has no boundary to straddle.
 *
 * Enforced through the mutations below rather than from each action, so a
 * request that passes one check and fails the next rolls back both.
 */

import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v, type Infer } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Every add-flow call (preview or confirm, either branch), every plan.
  addSkill: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 20 },
  // Capped plans only. Replaces the old 30-an-hour `userThrottles` window.
  addSkillCapped: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 60,
  },
  // Uncached repo analyses, per user (or one shared key for signed-out demo
  // runs, which only miss the cache after the demo repo changes).
  repoAnalysis: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  // The repo picker: a Clerk Backend API call plus the user's own GitHub token.
  githubRepoList: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  // Checkout and customer-portal sessions. Polar's API limit is org-wide, so
  // one account looping here could block checkout for everyone.
  billing: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
});

const rateLimitName = v.union(
  v.literal("addSkill"),
  v.literal("addSkillCapped"),
  v.literal("repoAnalysis"),
  v.literal("githubRepoList"),
  v.literal("billing"),
);

type RateLimitName = Infer<typeof rateLimitName>;

const SLOW_DOWN =
  "You're going faster than we can keep up. Wait a minute and try again.";

const MESSAGES: Record<RateLimitName, string> = {
  addSkill: SLOW_DOWN,
  addSkillCapped:
    "You've made a lot of add requests in the last hour. Try again in a little while.",
  repoAnalysis: SLOW_DOWN,
  githubRepoList: SLOW_DOWN,
  billing: SLOW_DOWN,
};

const checkValidator = v.object({
  name: rateLimitName,
  key: v.string(),
});

async function consume(
  ctx: MutationCtx,
  checks: Infer<typeof checkValidator>[],
): Promise<void> {
  for (const { name, key } of checks) {
    const { ok, retryAfter } = await rateLimiter.limit(ctx, name, { key });
    if (!ok) {
      throw new ConvexError({
        code: "rate_limited",
        message: MESSAGES[name],
        retryAfter,
      });
    }
  }
}

/**
 * Consume one unit from each listed limit for its key, in order. Throws
 * `ConvexError({ code: "rate_limited", message, retryAfter })` on the first
 * one that's out, and the rollback returns anything consumed before it.
 */
export const enforce = internalMutation({
  args: { checks: v.array(checkValidator) },
  returns: v.null(),
  handler: async (ctx, { checks }) => {
    await consume(ctx, checks);
    return null;
  },
});

/**
 * The add flow's limits, in one place because three public actions share
 * them (skills.addSkillManuallyPublic and the two GitHub-only actions).
 * `capped` is true when the caller's plan has a finite GitHub-only add quota.
 */
export const enforceAddSkill = internalMutation({
  args: {
    userId: v.id("users"),
    capped: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, capped }) => {
    await consume(ctx, [
      { name: "addSkill", key: userId },
      ...(capped ? [{ name: "addSkillCapped" as const, key: userId }] : []),
    ]);
    return null;
  },
});

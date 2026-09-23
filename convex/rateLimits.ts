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
 * **The one allowance: signed-out repo matching.** `repoAnalysisAnonymous`
 * deliberately does reach a person: a few free runs, then a sign-in prompt.
 * It is per visitor, keyed by an HMAC of the IP from the site's server action
 * (raw IPs never reach Convex), and charged only for runs that produced
 * results. Free accounts' monthly allowance lives in repoMatchQuota.ts.
 *
 * The component never prunes, so `pruneStale` (daily cron) deletes rows over
 * a week old, which the privacy page promises. That clears every limit, which
 * is safe because they all refill within a day.
 *
 * Token buckets rather than fixed windows: a fixed window without a `start`
 * gets a random boundary per key, and a burst straddling it gets double the
 * allowance. A bucket has no boundary to straddle.
 *
 * Enforced through the mutations below rather than from each action, so a
 * request that passes one check and fails the next rolls back both.
 */

import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v, type Infer } from "convex/values";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { ANON_DAILY_ANALYSES, ANON_LIMIT } from "../lib/repo-match";

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
  // runs, which only miss the cache after the demo repo changes; signed-out
  // runs through the site are keyed per visitor instead).
  repoAnalysis: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  // Signed-out repo matching, per visitor key: an allowance, see the header.
  repoAnalysisAnonymous: {
    kind: "token bucket",
    rate: ANON_DAILY_ANALYSES,
    period: DAY,
    capacity: ANON_DAILY_ANALYSES,
  },
  // Every fresh attempt by a free account or signed-out visitor, success or
  // not. The allowances skip errors, so this is what bounds misses on the
  // shared GitHub token. Never charged to Pro.
  repoAnalysisDaily: {
    kind: "token bucket",
    rate: 20,
    period: DAY,
    capacity: 20,
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
  v.literal("repoAnalysisAnonymous"),
  v.literal("repoAnalysisDaily"),
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
  repoAnalysisAnonymous: `You've used your ${ANON_DAILY_ANALYSES} free repo matches for now.`,
  repoAnalysisDaily:
    "You've tried a lot of repos today. Try again tomorrow, or upgrade to Pro.",
  githubRepoList: SLOW_DOWN,
  billing: SLOW_DOWN,
};

// Refusal codes other than "rate_limited": ones the UI answers with a prompt.
const CODES: Partial<Record<RateLimitName, string>> = {
  repoAnalysisAnonymous: ANON_LIMIT,
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
        code: CODES[name] ?? "rate_limited",
        message: MESSAGES[name],
        retryAfter,
      });
    }
  }
}

/**
 * Consume one unit from each listed limit for its key, in order. Throws
 * `ConvexError({ code, message, retryAfter })` on the first one that's out
 * (`code` is "rate_limited" unless CODES says otherwise), and the rollback
 * returns anything consumed before it.
 */
export const enforce = internalMutation({
  args: { checks: v.array(checkValidator) },
  returns: v.null(),
  handler: async (ctx, { checks }) => {
    await consume(ctx, checks);
    return null;
  },
});

/** Would one unit be allowed now? Consumes nothing (charge-after-success). */
export const peek = internalQuery({
  args: checkValidator,
  returns: v.object({ ok: v.boolean(), retryAfter: v.optional(v.number()) }),
  handler: async (ctx, { name, key }) => {
    const { ok, retryAfter } = await rateLimiter.check(ctx, name, { key });
    return { ok, retryAfter };
  },
});

/** Delete rate-limit rows over a week old, hashed visitor IPs included. */
export const pruneStale = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(components.rateLimiter.lib.clearAll, {
      before: Date.now() - 7 * DAY,
    });
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

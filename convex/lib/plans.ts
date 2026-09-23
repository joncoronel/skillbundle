import { QueryCtx } from "../_generated/server";
import { polar } from "../polar";
import { getCurrentUser } from "../users";

import { FREE_WATCHED_SKILLS } from "../../lib/bundle-limits";

export type Plan = "free" | "pro";

/**
 * What a plan may do.
 *
 * Three principles this set is built on, worth keeping when it changes:
 *
 * 1. **Safety is never a tier.** Every plan sees every change to a watched
 *    skill the moment it is detected, security regressions included. An earlier
 *    draft of PRODUCT.md had Pro getting "immediate" alerts, which prices the
 *    news that someone's dependency became unsafe. A monitoring product that
 *    does that has nothing left to sell.
 * 2. **Charge for scale of dependence, not for organisation.** The cap used to
 *    be 3 BUNDLES, which punished keeping two tidy lists instead of one messy
 *    one. It is now the number of distinct skills watched — the thing that
 *    actually tracks how much someone relies on this.
 * 3. **Charge for what costs money to run.** Repo auto-detection (GitHub tree
 *    walks, embeddings, fingerprint matching) and GitHub-only adds (discovery,
 *    content fetch, audit) both have real marginal cost per use, so free gets
 *    a small allowance of each and Pro gets them unlimited. Watching does
 *    not, which is why the free tier can be generous with it.
 */
export interface PlanLimits {
  /**
   * Distinct `source::skillId` pairs across ALL the user's bundles. Distinct,
   * not summed: filing one skill in two bundles is organisation, and organising
   * is not the thing being metered.
   */
  maxWatchedSkills: number;
  canAutoDetect: boolean;
  // Lifetime cap on GitHub-only skill adds (skills that don't exist on
  // skills.sh at all). Normal skills.sh adds are always free/unlimited — they
  // carry no abuse risk and just accelerate an inevitable sync. Counted by
  // `addedBy` rows whose immutable `leaderboard === "github"` origin tag.
  maxGitHubOnlyAdds: number;
}

// Re-exported, not redeclared. The single definition lives in the
// dependency-free `lib/bundle-limits.ts` so the enforced value and the value
// the pricing page advertises cannot drift apart.
export { FREE_WATCHED_SKILLS };

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxWatchedSkills: FREE_WATCHED_SKILLS,
    // False = repo match is metered (lib/repo-match.ts), not refused. The
    // GitHub repo picker stays Pro-only on this flag.
    canAutoDetect: false,
    maxGitHubOnlyAdds: 3,
  },
  pro: {
    maxWatchedSkills: Infinity,
    canAutoDetect: true,
    maxGitHubOnlyAdds: Infinity,
  },
};

/**
 * Feature gating master switch.
 * Set to `true` to enforce plan limits, `false` to keep everything free (MVP mode).
 */
export const FEATURE_GATING_ENABLED = true;

export function getPlanLimits(plan: Plan): PlanLimits {
  if (!FEATURE_GATING_ENABLED) {
    return PLAN_LIMITS.pro;
  }
  return PLAN_LIMITS[plan];
}

/**
 * Subscription statuses that count as paying.
 *
 * `polar.getCurrentSubscription` returns any subscription that hasn't ended,
 * whatever its status (it only filters out an expired trial), so without this
 * `incomplete` and `unpaid` subscriptions were Pro. `past_due` stays in on
 * purpose: Polar is still retrying the renewal, and taking features away from
 * someone whose card failed once is worse than a few days of grace. If the
 * retries fail, Polar moves the subscription on and it drops out here.
 */
const PRO_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/**
 * The plan a subscription grants. Split out of `getUserPlan` so the rule can be
 * tested without a Polar component in convex-test (tests/plans.test.ts).
 */
export function planForSubscription(
  subscription: { status: string; productKey?: string } | null,
): Plan {
  if (!subscription || !PRO_STATUSES.has(subscription.status)) return "free";
  const { productKey } = subscription;
  return productKey === "proMonthly" || productKey === "proYearly"
    ? "pro"
    : "free";
}

/**
 * Resolve the current user's plan from their active Polar subscription.
 * Returns "free" if no active subscription exists.
 */
export async function getUserPlan(ctx: QueryCtx): Promise<Plan> {
  const user = await getCurrentUser(ctx);
  if (!user) return "free";

  try {
    return planForSubscription(
      await polar.getCurrentSubscription(ctx, { userId: user._id }),
    );
  } catch {
    return "free";
  }
}

export async function getUserPlanWithLimits(ctx: QueryCtx) {
  const plan = await getUserPlan(ctx);
  const limits = getPlanLimits(plan);
  return { plan, limits };
}

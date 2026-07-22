import { QueryCtx } from "../_generated/server";
import { polar } from "../polar";
import { getCurrentUser } from "../users";

export type Plan = "free" | "pro";

export interface PlanLimits {
  maxBundles: number;
  canMakePrivate: boolean;
  canAutoDetect: boolean;
  canViewAnalytics: boolean;
  canExport: boolean;
  // Lifetime cap on GitHub-only skill adds (skills that don't exist on
  // skills.sh at all). Normal skills.sh adds are always free/unlimited — they
  // carry no abuse risk and just accelerate an inevitable sync. Counted by
  // `addedBy` rows whose immutable `leaderboard === "github"` origin tag.
  maxGitHubOnlyAdds: number;
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxBundles: 3,
    canMakePrivate: false,
    // Pro-only, but the demo allowlist (lib/repo-match.ts) still runs free for
    // everyone so people can taste repo match before upgrading. Enforced in
    // convex/recommendations.ts.
    canAutoDetect: false,
    canViewAnalytics: false,
    canExport: false,
    maxGitHubOnlyAdds: 3,
  },
  pro: {
    maxBundles: Infinity,
    canMakePrivate: true,
    canAutoDetect: true,
    canViewAnalytics: true,
    canExport: true,
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
 * Resolve the current user's plan from their active Polar subscription.
 * Returns "free" if no active subscription exists.
 */
export async function getUserPlan(ctx: QueryCtx): Promise<Plan> {
  const user = await getCurrentUser(ctx);
  if (!user) return "free";

  try {
    const subscription = await polar.getCurrentSubscription(ctx, {
      userId: user._id,
    });

    if (!subscription) return "free";

    const productKey = subscription.productKey;
    if (productKey === "proMonthly" || productKey === "proYearly") return "pro";

    return "free";
  } catch {
    return "free";
  }
}

export async function getUserPlanWithLimits(ctx: QueryCtx) {
  const plan = await getUserPlan(ctx);
  const limits = getPlanLimits(plan);
  return { plan, limits };
}

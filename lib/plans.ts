/**
 * Display copy for the pricing surfaces. The enforceable truth lives in
 * `convex/lib/plans.ts`; nothing may be claimed here that is not gated there.
 *
 * Two bullets on the previous version had stopped being true — "private
 * bundles" (now free for everyone) and "bundle analytics" (the tables were
 * deleted with the social layer). A pricing page is the one surface where a
 * stale feature list is a lie rather than an oversight, so when the gates
 * change, this file changes in the same commit.
 *
 * The page renders `features` as-is, and Pro's list sits under an "Everything
 * in Free, plus" heading, so Pro lists ONLY what Free does not have. Do not add
 * a shared capability to Pro's list to make it look longer; the heading already
 * says it.
 */
export type Plan = "free" | "pro";

// One definition, shared with the enforcement side. This used to be a second
// literal kept in step with the first by a comment.
export { FREE_WATCHED_SKILLS } from "./bundle-limits";
import { FREE_WATCHED_SKILLS } from "./bundle-limits";

export interface PlanDisplayInfo {
  name: string;
  tagline: string;
  description: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  features: string[];
  highlighted?: boolean;
  cta: {
    free: string;
    upgrade: string;
    manage: string;
  };
}

export const PLANS: Record<Plan, PlanDisplayInfo> = {
  free: {
    name: "Free",
    tagline: "Watch your setup",
    description: "The whole product, at personal scale.",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      `Watch up to ${FREE_WATCHED_SKILLS} skills`,
      "Every change, the day it happens",
      "Security regressions, never held back",
      "Full version history and diffs",
      "Unlimited lists to organise them",
      "Browse, search and compare the catalog",
    ],
    cta: {
      free: "Start watching",
      upgrade: "Start watching",
      manage: "Current plan",
    },
  },
  pro: {
    name: "Pro",
    tagline: "For a setup you depend on",
    description: "Unlimited watching, plus the expensive lookups.",
    priceMonthly: 5,
    priceYearly: 48,
    highlighted: true,
    features: [
      "Watch unlimited skills",
      "Match skills to any GitHub repo",
      "Unlimited GitHub-only skill adds",
    ],
    cta: {
      free: "Go Pro",
      upgrade: "Upgrade to Pro",
      manage: "Manage subscription",
    },
  },
};

export function yearlySavingsPercent(plan: PlanDisplayInfo): number | null {
  if (!plan.priceMonthly || !plan.priceYearly) return null;
  const fullYear = plan.priceMonthly * 12;
  if (fullYear <= 0) return null;
  return Math.round(((fullYear - plan.priceYearly) / fullYear) * 100);
}

/** Dollars saved by paying yearly instead of twelve monthly payments. */
export function yearlySavingsDollars(plan: PlanDisplayInfo): number | null {
  if (!plan.priceMonthly || !plan.priceYearly) return null;
  const saved = plan.priceMonthly * 12 - plan.priceYearly;
  return saved > 0 ? saved : null;
}

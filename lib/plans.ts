/**
 * Display copy for the pricing surfaces. The enforceable truth lives in
 * `convex/lib/plans.ts`; nothing may be claimed here that is not gated there.
 *
 * Two bullets on the previous version had stopped being true — "private
 * bundles" (now free for everyone) and "bundle analytics" (the tables were
 * deleted with the social layer). A pricing page is the one surface where a
 * stale feature list is a lie rather than an oversight, so when the gates
 * change, this file changes in the same commit.
 */
export type Plan = "free" | "pro";

/** Mirrors `FREE_WATCHED_SKILLS` in convex/lib/plans.ts. */
export const FREE_WATCHED_SKILLS = 25;

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
      "Security regressions included",
      "Full version history and diffs",
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
      "Point it at a repo, get matched skills",
      "Unlimited GitHub-only skill adds",
      "Everything in Free",
    ],
    cta: {
      free: "Go Pro",
      upgrade: "Upgrade to Pro",
      manage: "Manage subscription",
    },
  },
};

export type ComparisonValue = boolean | string;

export interface ComparisonRow {
  label: string;
  free: ComparisonValue;
  pro: ComparisonValue;
  /** Shown under the label. For rows where the honest answer needs a caveat. */
  note?: string;
}

export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

export const COMPARISON: ComparisonGroup[] = [
  {
    title: "Monitoring",
    rows: [
      {
        label: "Skills watched",
        free: `Up to ${FREE_WATCHED_SKILLS}`,
        pro: "Unlimited",
        note: "Counted once per skill, however many lists it sits in.",
      },
      { label: "Content and description changes", free: true, pro: true },
      {
        label: "Security verdict regressions",
        free: true,
        pro: true,
        note: "Never held back by plan. Nobody should pay to hear this.",
      },
      { label: "Full version history and diffs", free: true, pro: true },
      { label: "Lists to organise them into", free: "Unlimited", pro: "Unlimited" },
    ],
  },
  {
    title: "Discovery",
    rows: [
      { label: "Browse, search and compare", free: true, pro: true },
      {
        label: "Match skills to a GitHub repo",
        free: "Demo repo only",
        pro: true,
        note: "Reads the repo's dependencies and matches against the catalog.",
      },
    ],
  },
  {
    title: "Contributing",
    rows: [
      { label: "Add skills that are on skills.sh", free: true, pro: true },
      { label: "Add skills that only exist on GitHub", free: "Up to 3", pro: "Unlimited" },
    ],
  },
];

export function yearlySavingsPercent(plan: PlanDisplayInfo): number | null {
  if (!plan.priceMonthly || !plan.priceYearly) return null;
  const fullYear = plan.priceMonthly * 12;
  if (fullYear <= 0) return null;
  return Math.round(((fullYear - plan.priceYearly) / fullYear) * 100);
}

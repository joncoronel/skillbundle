export type Plan = "free" | "pro";

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
    tagline: "For curious builders",
    description: "Everything you need to start stacking skills.",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      "Browse, search & compare skills",
      "3 saved bundles",
      "Public bundles only",
      "Basic install commands",
    ],
    cta: {
      free: "Start free",
      upgrade: "Start free",
      manage: "Current plan",
    },
  },
  pro: {
    name: "Pro",
    tagline: "For power users",
    description: "Auto-detect, unlimited bundles, private sharing.",
    priceMonthly: 8,
    priceYearly: 72,
    highlighted: true,
    features: [
      "GitHub repo auto-detection",
      "Unlimited saved bundles",
      "Private bundles",
      "Bundle analytics",
    ],
    cta: {
      free: "Get started",
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
}

export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

export const COMPARISON: ComparisonGroup[] = [
  {
    title: "Discovery",
    rows: [
      { label: "Browse all skills", free: true, pro: true },
      { label: "Search & compare skills", free: true, pro: true },
      { label: "GitHub repo auto-detection", free: false, pro: true },
    ],
  },
  {
    title: "Bundles",
    rows: [
      { label: "Saved bundles", free: "Up to 3", pro: "Unlimited" },
      { label: "Public bundles", free: true, pro: true },
      { label: "Private bundles", free: false, pro: true },
      { label: "Bundle analytics (views, copies)", free: false, pro: true },
    ],
  },
];

export function yearlySavingsPercent(plan: PlanDisplayInfo): number | null {
  if (!plan.priceMonthly || !plan.priceYearly) return null;
  const fullYear = plan.priceMonthly * 12;
  if (fullYear <= 0) return null;
  return Math.round(((fullYear - plan.priceYearly) / fullYear) * 100);
}

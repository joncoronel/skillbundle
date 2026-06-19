import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type PlanData = FunctionReturnType<typeof api.plans.currentPlan>;

interface BundleLike {
  copyCount?: number;
  forkCount?: number;
}

interface DashboardStatsProps {
  bundles: BundleLike[];
  plan: PlanData["plan"];
  limits: PlanData["limits"];
}

export function DashboardStats({ bundles, plan, limits }: DashboardStatsProps) {
  const totals = bundles.reduce(
    (acc, b) => ({
      copies: acc.copies + (b.copyCount ?? 0),
      forks: acc.forks + (b.forkCount ?? 0),
    }),
    { copies: 0, forks: 0 },
  );

  const maxBundles = limits.maxBundles;
  const hasCap = Number.isFinite(maxBundles);
  const atCap = hasCap && bundles.length >= maxBundles;
  const bundlesValue = hasCap
    ? `${bundles.length}/${maxBundles}`
    : `${bundles.length}`;
  const planLabel = hasCap
    ? plan === "free"
      ? "Free plan"
      : undefined
    : "Unlimited";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <Metric value={bundlesValue} label="bundles" />
      <Separator />
      <Metric value={formatNumber(totals.copies)} label="copies" />
      <Separator />
      <Metric value={formatNumber(totals.forks)} label="forks" />
      {planLabel ? (
        <>
          <Separator />
          <span
            className={cn(
              atCap ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {planLabel}
          </span>
        </>
      ) : null}
      {/* At-cap indicator is independent of planLabel, so it still surfaces
          if a future capped paid tier leaves planLabel undefined. */}
      {atCap ? (
        <>
          <Separator />
          <span className="font-medium text-foreground">limit reached</span>
          {plan === "free" ? (
            <Link
              href="/pricing"
              className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors hover:decoration-foreground"
            >
              Upgrade
            </Link>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Separator() {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  );
}

function formatNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type PlanData = FunctionReturnType<typeof api.plans.currentPlan>;

interface BundleLike {
  viewCount?: number;
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
      views: acc.views + (b.viewCount ?? 0),
      copies: acc.copies + (b.copyCount ?? 0),
      forks: acc.forks + (b.forkCount ?? 0),
    }),
    { views: 0, copies: 0, forks: 0 },
  );

  const maxBundles = limits.maxBundles;
  const hasCap = Number.isFinite(maxBundles);
  const atCap = hasCap && bundles.length >= maxBundles;
  const bundlesValue = hasCap
    ? `${bundles.length}/${maxBundles}`
    : `${bundles.length}`;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCell
        label="Bundles"
        value={bundlesValue}
        sub={hasCap ? (plan === "free" ? "Free plan" : undefined) : "Unlimited"}
        emphasize={atCap}
      />
      <StatCell label="Views" value={formatNumber(totals.views)} />
      <StatCell label="Copies" value={formatNumber(totals.copies)} />
      <StatCell label="Forks" value={formatNumber(totals.forks)} />
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  emphasize,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasize?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg px-5 py-5",
        emphasize ? "bg-accent/40" : "bg-muted/40",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {emphasize && (
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-primary"
          />
        )}
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums leading-none">
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-xs text-muted-foreground/80">{sub}</p>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

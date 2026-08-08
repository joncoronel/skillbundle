import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type PlanData = FunctionReturnType<typeof api.plans.currentPlan>;

interface DashboardStatsProps {
  /** Every bundle's skills, so the distinct count can be derived here. */
  bundles: Array<{ skills: Array<{ source: string; skillId: string }> }>;
  plan: PlanData["plan"];
  limits: PlanData["limits"];
}

export function DashboardStats({ bundles, plan, limits }: DashboardStatsProps) {
  // Distinct across bundles, matching what the server meters. Filing one skill
  // in two lists is organisation, and organising is not what is being counted.
  const watched = new Set<string>();
  for (const b of bundles) {
    for (const s of b.skills) watched.add(`${s.source}::${s.skillId}`);
  }

  const max = limits.maxWatchedSkills;
  const hasCap = Number.isFinite(max);
  const atCap = hasCap && watched.size >= max;
  const bundlesValue = hasCap ? `${watched.size}/${max}` : `${watched.size}`;
  const planLabel = hasCap
    ? plan === "free"
      ? "Free plan"
      : undefined
    : "Unlimited";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <Metric value={bundlesValue} label="skills watched" />
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

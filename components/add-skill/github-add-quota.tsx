"use client";

import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

/**
 * The signed-in free user's GitHub-only-add allowance, as a compact meter.
 * Renders nothing for signed-out or Pro users (unlimited) — there's no quota to
 * show. skills.sh adds are never counted, so this only speaks to the capped kind.
 */
export function GitHubAddQuota({ className }: { className?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const { data } = useQuery({
    ...convexQuery(api.skills.myGitHubAddQuota, {}),
    enabled: isAuthenticated,
  });

  if (!data || data.limit === null) return null;
  const { used, limit } = data;
  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const atLimit = used >= limit;

  return (
    <div className={cn("rounded-lg border border-border p-3", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">GitHub-only adds</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {used} of {limit} used
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label="GitHub-only adds used"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            atLimit ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {atLimit ? (
          <>
            You&apos;ve used all your free adds.{" "}
            <Link
              href="/pricing"
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Upgrade to Pro
            </Link>{" "}
            for unlimited.
          </>
        ) : (
          <>
            {remaining} left on the free plan. Skills already on skills.sh are
            unlimited.
          </>
        )}
      </p>
    </div>
  );
}

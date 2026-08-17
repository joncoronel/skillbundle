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
 *
 * Deliberately borderless and untitled: it is mounted INSIDE the GitHub-only
 * outcome it meters, which already names it. As a bordered box in a sidebar it
 * read as an unrelated widget, and a free user had to infer for themselves
 * which of the two add paths it applied to.
 */
export function GitHubAddQuota({ className }: { className?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const { data } = useQuery({
    ...convexQuery(api.skills.myGitHubAddQuota, {}),
    enabled: isAuthenticated,
  });

  // Signed-out visitors and Pro accounts have no quota to show, and no
  // geometry to reserve either.
  if (!isAuthenticated) return null;
  // Reserved while the query is in flight, because this now mounts inside the
  // page's PRIMARY register rather than a sidebar: without a placeholder the
  // meter's arrival pushes the third outcome row and everything under it down.
  // The opacity fade below hides the appearance, never the reflow. Height is
  // the resolved block's: bar 6px + `mt-2` 8px + one line of `text-xs` 16px.
  if (!data) return <div className={cn("h-[30px]", className)} aria-hidden />;
  if (data.limit === null) return null;
  // `atLimit` comes from the server (single source of the comparison rule);
  // `used` is already clamped to the limit there, so the ARIA values below
  // stay valid even for an account whose Pro-era history exceeded the cap.
  const { used, limit, atLimit } = data;
  const remaining = Math.max(0, limit - used);
  const pct = Math.min(100, Math.round((used / limit) * 100));

  return (
    <div
      className={cn(
        // The block mounts only once the quota query resolves; fade it in per
        // the house pattern instead of popping the row's text down a line.
        "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none starting:opacity-0",
        className,
      )}
    >
      <div
        className="h-1.5 max-w-56 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.min(used, limit)}
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
            You&apos;ve used all {limit} of your free GitHub-only adds.{" "}
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
            <span className="tabular-nums">
              {used} of {limit}
            </span>{" "}
            used on your free plan, {remaining} left.
          </>
        )}
      </p>
    </div>
  );
}

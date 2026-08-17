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

  // NOTHING is reserved while the query is in flight, and that is deliberate.
  //
  // A 30px placeholder was tried here, to keep the meter's arrival from pushing
  // the third outcome row down (this mounts inside the page's primary register
  // now, not a sidebar). It has to be reverted rather than tuned, because the
  // bet it makes is wrong for a whole class of accounts: whether a meter ever
  // appears depends on `limit`, which arrives WITH the data, so there is no
  // earlier signal to reserve against. `isAuthenticated` is not that signal —
  // it resolves for Pro accounts too, and they get `limit: null` and render
  // nothing. For them the reservation was a 42px empty gap that appeared once
  // Clerk resolved and vanished one round trip later, in the middle of a
  // register. Measured, not guessed.
  //
  // So the house rule about holding height across a loading→resolved
  // transition (DESIGN.md §8) does not reach this component: it assumes the
  // placeholder is replaced by content, and here it often is not. A free
  // account still gets one 42px push when the meter lands. That is content
  // arriving, which reads as normal; an empty hole reads as a bug.
  if (!isAuthenticated || !data || data.limit === null) return null;
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
      {/* Both states are ONE line at every width, which is what makes the
          reservation above a correct height rather than an average of two.
          The long form of the at-limit sentence measured 411px: one line in
          the 440px outcome column, two at 326px on a phone, so an at-limit
          account was the one case that still shifted when the query landed.
          Nothing was lost in shortening it. "your free GitHub-only adds"
          restated the row this sits in, which is titled "It's only in a
          GitHub repo", and "for unlimited" restated the clause directly
          above it. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {atLimit ? (
          <>
            All <span className="tabular-nums">{limit}</span> free adds used.{" "}
            <Link
              href="/pricing"
              className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              Upgrade to Pro
            </Link>
            .
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

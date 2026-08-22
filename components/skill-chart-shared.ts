import type { CSSProperties } from "react";

// Pure helpers, types, and tokens shared across the three chart surfaces (the
// sidebar sparkline, the install dialog chart, and the compare chart). Kept free
// of any chart-engine import on purpose: each page imports only the chart file it
// renders, so this shared layer must not drag `LineChart`/`ComposedChart` into
// every bundle.

export type SkillInsights = {
  snapshots: { day: string; installs: number }[];
  /** null only for an orphaned skill row (no skillSummaries mirror) — render a
   *  dash rather than a zero. See getInsights in convex/skills.ts. */
  installs: number | null;
  installRank: number | null;
};

export type SparklineHoverState = { value: number; day: string } | null;

// Fewest snapshots needed to draw a line at all — two points make a segment, so
// below this (0–1 points, day one) the sidebar shows the "still collecting"
// ghost instead. skills.sh has no history to backfill, so the series grows
// ~1 point/day from when recording starts.
export const MIN_POINTS = 2;

export const intFmt = new Intl.NumberFormat("en-US").format;

/**
 * Axis-width install counts: "100k", "1.5M". Distinct from `formatInstalls`,
 * which always keeps a decimal ("100.0k") — fine in a stat tile, too wide on an
 * axis, where it crowds the first date label in the bottom-left corner.
 */
export function compactCount(n: number) {
  const [value, suffix] =
    n >= 1_000_000
      ? [n / 1_000_000, "M"]
      : n >= 1_000
        ? [n / 1_000, "k"]
        : [n, ""];
  return `${Number(value.toFixed(1))}${suffix}`;
}

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Format a "YYYY-MM-DD" snapshot day for an axis tick or the hover label.
 *
 * Formatting in UTC is what makes this exact: a snapshot day is a calendar date
 * with no time in it, so rendering it in the reader's zone is what used to shift
 * labels a day early west of UTC. `toDate`'s noon anchor works around that for
 * date arithmetic; charts don't need the workaround because they never leave the
 * string behind.
 */
export function dayLabel(day: string) {
  return dayFmt.format(new Date(`${day}T00:00:00Z`));
}

/** The same day with its weekday, for the tooltip heading. */
export function dayLabelLong(day: string) {
  return weekdayFmt.format(new Date(`${day}T00:00:00Z`));
}

// The bklit charts read their palette from `--chart-*` CSS variables, which
// this project's Tailwind v4 build tree-shakes out (they're only referenced in
// runtime SVG). Set them inline on the chart wrapper instead — inline styles
// are never pruned — mapped to app tokens so the chart tracks the theme.
export const CHART_VARS = {
  "--chart-1": "var(--primary)",
  "--chart-line-primary": "var(--primary)",
  "--chart-grid": "var(--border)",
  "--chart-crosshair": "var(--primary)",
  "--chart-label": "var(--muted-foreground)",
  "--chart-foreground": "var(--foreground)",
  "--chart-foreground-muted": "var(--muted-foreground)",
  "--chart-background": "var(--background)",
  "--chart-marker-background": "var(--background)",
  "--chart-marker-border": "var(--border)",
  "--chart-marker-foreground": "var(--foreground)",
  "--chart-ring-background": "transparent",
  "--chart-tooltip-background": "var(--popover)",
  "--chart-tooltip-foreground": "var(--popover-foreground)",
  "--chart-tooltip-muted": "var(--muted-foreground)",
} as CSSProperties;

/**
 * Parse a "YYYY-MM-DD" snapshot day into a Date pinned to UTC noon. Anchoring at
 * noon (not midnight) means local-timezone formatters render the correct
 * calendar day for any zone within ±12h of UTC — a bare `new Date("2026-06-17")`
 * is UTC midnight, which a negative-offset zone (e.g. US Pacific) formats as the
 * *previous* day. (Past +12h, e.g. Kiribati, the label can still read a day
 * ahead, but that's a negligible audience.) Used for the trailing-week math here
 * AND as the chart x-values: the bklit axis/tooltip format these Dates with
 * local-tz Intl formatters, so passing a Date (used as-is) avoids the off-by-one.
 */
export function toDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

/**
 * The trailing ~7-day window: from the snapshot at or before 7 days ago (the
 * baseline the gain is measured from) through the latest. Both `weekGain` and the
 * sidebar sparkline read from this, so the sparkline always starts exactly where
 * the "+N past 7d" stat counts from — they can't drift apart even if a daily
 * snapshot is missing (a count-based slice would reach a different point than
 * this date-based baseline). Returns the input untouched when it has under two
 * points.
 */
export function weekWindow(snapshots: SkillInsights["snapshots"]) {
  if (snapshots.length < 2) return snapshots;
  const latest = snapshots[snapshots.length - 1];
  const cutoff = toDate(latest.day).getTime() - 7 * 86_400_000;
  let startIdx = 0;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (toDate(snapshots[i].day).getTime() <= cutoff) {
      startIdx = i;
      break;
    }
  }
  return snapshots.slice(startIdx);
}

/**
 * Installs gained over the trailing ~7 days, measured from the window baseline.
 * Null until the window has two points, or when the change isn't positive.
 */
export function weekGain(snapshots: SkillInsights["snapshots"]) {
  const windowPoints = weekWindow(snapshots);
  if (windowPoints.length < 2) return null;
  const gain =
    windowPoints[windowPoints.length - 1].installs - windowPoints[0].installs;
  return gain > 0 ? gain : null;
}

/**
 * One-sentence text summary of a cumulative install series, used as the
 * `aria-label` so screen readers get the trend the chart SVG (aria-hidden) only
 * shows visually.
 */
export function seriesSummary(snapshots: SkillInsights["snapshots"]) {
  if (snapshots.length === 0) return "no data yet";
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (snapshots.length === 1) return `${intFmt(last.installs)} installs`;
  const verb = last.installs > first.installs ? "rose" : "held steady";
  return `${verb} from ${intFmt(first.installs)} to ${intFmt(last.installs)} installs over ${snapshots.length} days`;
}

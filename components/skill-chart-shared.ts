import type { CSSProperties } from "react";

// Pure helpers, types, and tokens shared across the three chart surfaces (the
// sidebar sparkline, the install dialog chart, and the compare chart). Kept free
// of any chart-engine import on purpose: each page imports only the chart file it
// renders, so this shared layer must not drag `LineChart`/`ComposedChart` into
// every bundle.

export type SkillInsights = {
  snapshots: { day: string; installs: number }[];
  installs: number;
  installRank: number | null;
};

export type SparklineHoverState = { value: number; day: string } | null;

// Fewest snapshots needed to draw a line at all — two points make a segment, so
// below this (0–1 points, day one) the sidebar shows the "still collecting"
// ghost instead. skills.sh has no history to backfill, so the series grows
// ~1 point/day from when recording starts.
export const MIN_POINTS = 2;

export const intFmt = new Intl.NumberFormat("en-US").format;

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

function toDate(day: string) {
  // "YYYY-MM-DD" is UTC; pin to UTC noon so the local label never slips a day.
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

// Pure helpers, types, and tokens shared across the three chart surfaces (the
// sidebar sparkline, the install dialog chart, and the compare chart). Kept free
// of any chart-engine import on purpose: each page imports only the chart file it
// renders, so this shared layer must not drag `@tanstack/charts` into every
// bundle.

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

/**
 * Parse a "YYYY-MM-DD" snapshot day into a Date pinned to UTC noon. Anchoring at
 * noon (not midnight) means local-timezone formatters render the correct
 * calendar day for any zone within ±12h of UTC — a bare `new Date("2026-06-17")`
 * is UTC midnight, which a negative-offset zone (e.g. US Pacific) formats as the
 * *previous* day. (Past +12h, e.g. Kiribati, the label can still read a day
 * ahead, but that's a negligible audience.) Used for the trailing-week math here
 * AND by `dayLabel` / `dayLabelLong`, which format with local-tz Intl
 * formatters, so anchoring at noon avoids the off-by-one.
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
  return dayWindow(snapshots, 7);
}

/**
 * `weekWindow` with the 7 lifted out: the trailing `days` of any day-keyed
 * series, measured back from the series' OWN last day rather than from today.
 *
 * That distinction is the whole point and is easy to lose. A skill whose sync
 * stalled a month ago still has history worth showing; cutting from `Date.now()`
 * would hand back an empty window for it. Cutting from the latest row always
 * returns something as long as the series has anything at all.
 *
 * Generic over the row rather than fixed to a snapshot, because the install
 * chart windows its DERIVED rows (which carry `daily`) and not the raw
 * snapshots — see the note on `daily` where those rows are built.
 */
export function dayWindow<T extends { day: string }>(
  rows: readonly T[],
  days: number,
): T[] {
  if (rows.length < 2) return [...rows];
  const latest = rows[rows.length - 1];
  const cutoff = toDate(latest.day).getTime() - days * 86_400_000;
  let startIdx = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (toDate(rows[i].day).getTime() <= cutoff) {
      startIdx = i;
      break;
    }
  }
  return rows.slice(startIdx);
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

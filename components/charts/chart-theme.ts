import type { CSSProperties } from "react";

// Presentation tokens shared by every chart. TanStack Charts paints guides with
// `currentColor` and reads a handful of `--ts-chart-*` custom properties off the
// host element, so the bridge between our OKLch design tokens and the chart is
// one inline style object rather than a theme object per definition.
//
// Inline (not a Tailwind class) for the same reason the old `CHART_VARS` was:
// these variables are only ever referenced from runtime SVG, so Tailwind's v4
// build prunes them from the stylesheet if they live in a class.

export const CHART_HOST_VARS = {
  // Guides resolve `currentColor`, so the host's own color is the axis/grid hue.
  color: "var(--muted-foreground)",
} as CSSProperties;

/** Axis, grid and guide colours handed to `defineChart`. */
export const CHART_THEME = {
  foreground: "var(--foreground)",
  muted: "var(--muted-foreground)",
  grid: "var(--border)",
  // Transparent on purpose: the theme's background is painted as a real rect
  // behind the scene, and any concrete colour here is wrong on at least one of
  // the three surfaces these charts sit on. The container owns the backdrop.
  background: "transparent",
  // Only consulted by colour scales, which none of these charts use — every
  // series names its own paint — but the field is required.
  palette: ["var(--primary)"],
} as const;

/**
 * Matches the old HTML axis labels: `text-chart-label text-xs`.
 *
 * `thin.minGap` is what controls date-axis density. A point or band scale
 * offers every category as a tick candidate and ignores a `count` or `spacing`
 * hint, so the only lever is how close two labels may sit before one is
 * dropped — which has the advantage of adapting to width on its own, where the
 * old chart's fixed `numTicks` did not.
 */
export const AXIS_TICK_LABELS = {
  fontSize: 12,
  thin: { minGap: 28 },
} as const;

/**
 * Room under the plot for the date labels and the pill that rides with them.
 *
 * Fixed rather than measured because the pill is an HTML overlay sitting in
 * that row (see `chart-hover-overlay`), and automatic margins size to the axis
 * alone — they know nothing about it.
 */
export const AXIS_LABEL_MARGIN = 34;
export const AXIS_LABEL_PADDING = 10;

/**
 * Wider, for a chart that also labels its y axis.
 *
 * The lowest y tick sits centred on the plot's bottom edge, so the dates have
 * to clear that label and not just the plot — without the extra gap the zero
 * and the first date collide in the corner. Only worth the vertical cost where
 * there is a y axis: on a phone this is a third of the chart's height.
 */
export const AXIS_LABEL_MARGIN_WITH_Y_AXIS = 48;
export const AXIS_LABEL_PADDING_WITH_Y_AXIS = 20;

/** Half the rendered height of a 12px tick label, measured against the axis. */
const AXIS_LABEL_HALF_HEIGHT = 5;

/** Half the pill's height: a 24px line box plus 4px of padding either side. */
const DATE_PILL_HALF_HEIGHT = 16;

/**
 * Distance from the chart's bottom edge to the date pill, chosen so the pill's
 * centre lands on the tick-label row it replaces.
 *
 * Derived rather than tuned per chart: the two charts reserve different bottom
 * margins, and a hand-picked offset silently misaligns the moment either the
 * margin or the tick padding changes.
 */
export function datePillOffset(margin: number, padding: number) {
  return Math.max(
    0,
    margin - padding - AXIS_LABEL_HALF_HEIGHT - DATE_PILL_HALF_HEIGHT,
  );
}

/**
 * Tick candidates per axis, on both the date axis and the grid.
 *
 * The old chart's `XAxis numTicks` and `Grid numTicksRows`, which were the same
 * number. Five date labels across two months, and five rules down the plot.
 */
export const AXIS_TICK_COUNT = 5;

/**
 * `count` values spread evenly across `values`, first and last included.
 *
 * For scales that offer every datum as a tick candidate and ignore `count` —
 * band and point — where the alternative is one label per row.
 *
 * `count` is a target, not a quota: a neighbouring count is used instead when
 * it divides the series exactly and `count` would not. The old chart did the
 * same (`selectEvenlySpacedIndices` scored every layout from `count - 1` to
 * `count + 1` and took the most even), and the difference shows on short
 * series: six days at a target of five gave 17/18/20/21/22, dropping the 19th
 * and leaving one gap twice the others. Six evenly spaced labels is the honest
 * axis for six points.
 */
export function evenlySpaced<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) {
    return [...values];
  }
  const last = values.length - 1;
  // A layout is exactly even when its gap count divides the span.
  const candidates = [count, count - 1, count + 1].filter(
    (n) => n >= 2 && n <= values.length,
  );
  const chosen = candidates.find((n) => last % (n - 1) === 0) ?? count;
  const step = last / (chosen - 1);
  return Array.from({ length: chosen }, (_, i) => values[Math.round(i * step)]);
}

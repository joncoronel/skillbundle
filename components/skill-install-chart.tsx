"use client";

import { useEffect, useMemo } from "react";
import { ComposedChart } from "@/components/charts/composed-chart";
import { SeriesBar } from "@/components/charts/series-bar";
import { Line } from "@/components/charts/line";
import { LineChart } from "@/components/charts/line-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { useChart } from "@/components/charts/chart-context";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";

export type SkillInsights = {
  snapshots: { day: string; installs: number }[];
  installs: number;
  installRank: number | null;
  totalSkills: number | null;
  trendingRank: number | null;
  hotChange: number | null;
};

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
const CHART_VARS = {
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
} as React.CSSProperties;

// The install dialog chart sits at surface-5, so a surface-3 tooltip wouldn't
// separate from it (in light mode both are pure white) — there the tooltip
// rides one tier above the dialog at surface-7, the cubby convention for a
// popover nested in a dialog. Glass blur off.
const TOOLTIP_PANEL_STYLE: React.CSSProperties = {
  background: "var(--surface-7)",
  color: "var(--popover-foreground)",
  boxShadow: "var(--surface-shadow-7), var(--surface-rim-7)",
  backdropFilter: "none",
};

// The compare chart renders inline on a card, which is itself surface-3
// (`--card: var(--surface-3)`). A surface-3 tooltip would share the card's exact
// tone (identical in dark) and only separate by shadow, so the tooltip rides two
// tiers up at surface-5 — the cubby +2 convention for a popover floating over its
// container — giving real tonal lift over the card. Glass blur off.
const TOOLTIP_PANEL_STYLE_INLINE: React.CSSProperties = {
  background: "var(--surface-5)",
  color: "var(--popover-foreground)",
  boxShadow: "var(--surface-shadow-5), var(--surface-rim-5)",
  backdropFilter: "none",
};

// Daily bars are the secondary series: the design system's neutral fill,
// softened so the Signal Blue total line stays the one accent.
const BAR_FILL = "color-mix(in oklch, var(--neutral) 65%, transparent)";

function toDate(day: string) {
  // "YYYY-MM-DD" is UTC; pin to UTC noon so the local label never slips a day.
  return new Date(`${day}T12:00:00Z`);
}

/** Percentile bucket (1–100) for an all-time install rank. */
export function topPercent(rank: number, total: number) {
  return Math.min(100, Math.max(1, Math.ceil((rank / total) * 100)));
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

export type SparklineHoverState = { value: number; day: string } | null;

/**
 * Compact cumulative-installs sparkline for the sidebar: bklit's line, keeping its
 * spring dot and the hover dim/highlight, scaled so the slope is actually visible.
 * The chart's y-domain is zero-based, and a cumulative count in the hundreds of
 * thousands moves only a few percent over a week — plotting the absolute total
 * pins the line flat at the top. So we plot each point's installs ABOVE the window
 * minimum instead, which makes the domain span the real variation; the hover
 * bridge still reads the untouched `installs` field, so the sidebar scrubs the
 * true total.
 */
export function InstallSparkline({
  points,
  onHover,
}: {
  points: SkillInsights["snapshots"];
  onHover?: (state: SparklineHoverState) => void;
}) {
  const data = useMemo(() => {
    const min = points.length ? Math.min(...points.map((p) => p.installs)) : 0;
    // `plot` = installs above the window floor: it drives the zero-based domain
    // so the line isn't flat. `installs` stays intact for the hover bridge.
    return points.map((p) => ({
      date: p.day,
      installs: p.installs,
      plot: p.installs - min,
    }));
  }, [points]);

  return (
    <div style={CHART_VARS}>
      <LineChart
        data={data}
        xDataKey="date"
        aspectRatio="7 / 1"
        animationDuration={0}
        margin={{ top: 4, right: 3, bottom: 4, left: 3 }}
        // The hover dot sits on the first/last point, which sit at the plot edges;
        // with margins this small the dot is wider than the margin, so the SVG's
        // default overflow:hidden shears it. Let the chart SVG overflow instead —
        // it keeps the line full-width (no inset) and only the dot spills, by a
        // few px, into the surrounding gutter.
        className="[&_svg]:overflow-visible"
      >
        <Line
          dataKey="plot"
          stroke="var(--primary)"
          strokeWidth={1.5}
          fadeEdges={false}
          animate={false}
        />
        {onHover && (
          <>
            {/* Box hidden (no popover over a 40px chart) and crosshair off, but
                the spring dot + line dim/highlight that ride along with the
                tooltip stay. The value is surfaced via the hover bridge. */}
            <ChartTooltip
              showCrosshair={false}
              showDatePill={false}
              panelStyle={{ display: "none" }}
            />
            <SparklineHoverBridge onHover={onHover} />
          </>
        )}
      </LineChart>
    </div>
  );
}

/** Pipes the hovered point's true total + day off the chart's interaction state. */
function SparklineHoverBridge({
  onHover,
}: {
  onHover: (state: SparklineHoverState) => void;
}) {
  const { tooltipData } = useChart();
  const point = tooltipData?.point;
  const value = typeof point?.installs === "number" ? point.installs : null;
  const day = typeof point?.date === "string" ? point.date : null;
  // Depend on the primitives, not the `tooltipData` object — its identity
  // changes every render, which would re-fire `onHover` (and the parent's
  // setState) in a loop.
  useEffect(() => {
    onHover(value != null && day != null ? { value, day } : null);
  }, [value, day, onHover]);
  return null;
}

/**
 * Faint placeholder for the sparkline before there's enough history: a ghost
 * trend line dissolving into the unrecorded future. No data, just a stand-in
 * for where the trend will live.
 */
export function InstallSparklineGhost() {
  return (
    <svg
      viewBox="0 0 120 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-10 w-full text-muted-foreground/45 mask-[linear-gradient(to_right,#000,#000_30%,transparent)]"
    >
      <path
        d="M0 25 C 18 23 30 18 46 17 C 62 16 78 11 96 8 C 108 5 114 5 120 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The full install history: cumulative total (line, right axis) + daily gained
 * (bars, default axis) on independent scales. Lives in the chart dialog where
 * it has room; the sidebar shows the sparkline and opens this on demand.
 */
export function InstallChart({ insights }: { insights: SkillInsights }) {
  const { snapshots } = insights;

  // One row per day: `total` (cumulative, the line) and `daily` (gained, the
  // bars). Day-over-day can dip negative on a correction; floor at 0.
  const series = useMemo(
    () =>
      snapshots.map((s, i) => ({
        date: s.day,
        total: s.installs,
        daily:
          i === 0 ? 0 : Math.max(0, s.installs - snapshots[i - 1].installs),
      })),
    [snapshots],
  );

  return (
    <div>
      <Legend />
      <div style={CHART_VARS}>
        <ComposedChart
          data={series}
          xDataKey="date"
          aspectRatio="5 / 2"
          maxBarSize={26}
          animationDuration={0}
          margin={{ top: 16, right: 14, bottom: 30, left: 14 }}
        >
          <Grid horizontal />
          {/* Bars on the default axis (daily, ~0–20), line on its own right
              axis (cumulative, hundreds) so each scales to fit. */}
          <SeriesBar
            animate={false}
            dataKey="daily"
            fill={BAR_FILL}
            radius={4}
          />
          <Line
            animate={false}
            dataKey="total"
            stroke="var(--primary)"
            strokeWidth={2}
            yAxisId="right"
          />
          <XAxis numTicks={6} />
          <ChartTooltip
            panelStyle={TOOLTIP_PANEL_STYLE}
            rows={(point) => [
              {
                color: "var(--primary)",
                label: "Total installs",
                value: point.total as number,
              },
              {
                color: BAR_FILL,
                label: "Daily installs",
                value: `+${intFmt(point.daily as number)}`,
              },
            ]}
          />
        </ComposedChart>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      <LegendItem label="Total installs">
        <span
          className="h-0.5 w-4 rounded-full"
          style={{ background: "var(--primary)" }}
        />
      </LegendItem>
      <LegendItem label="Daily installs">
        <span
          className="size-2.5 rounded-[3px]"
          style={{ background: BAR_FILL }}
        />
      </LegendItem>
    </div>
  );
}

function LegendItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className="flex w-4 justify-center">
        {children}
      </span>
      {label}
    </span>
  );
}

// One categorical color per compared skill, anchored on the brand accent. The
// compare page maps each column to its index here so the column header dot,
// legend swatch, and line all carry the same hue. Capped at the 3-column max.
export const COMPARE_LINE_COLORS = [
  "var(--compare-line-1)",
  "var(--compare-line-2)",
  "var(--compare-line-3)",
];

export type CompareSeries = {
  /** Stable dataKey for the merged rows (e.g. "s0") — avoids odd chars. */
  key: string;
  name: string;
  color: string;
  snapshots: SkillInsights["snapshots"];
};

/**
 * Merges each skill's daily snapshots onto a shared date axis: the union of all
 * days, each series carried forward over a skipped day and back-filled before
 * its first point, so every line spans the axis with no NaN gaps. Cumulative
 * installs are monotonic, so carry-forward is the correct fill for a missed
 * cron day; the leading back-fill only affects a skill that started recording
 * later than the others (a short flat lead-in).
 */
function buildCompareRows(series: CompareSeries[]) {
  const days = Array.from(
    new Set(series.flatMap((s) => s.snapshots.map((p) => p.day))),
  ).sort();

  const filled = series.map((s) => {
    const byDay = new Map(s.snapshots.map((p) => [p.day, p.installs] as const));
    let last: number | null = null;
    const forward = days.map((d) => {
      const v = byDay.get(d);
      if (v != null) last = v;
      return last;
    });
    const first = forward.find((v) => v != null) ?? null;
    return forward.map((v) => (v == null ? first : v));
  });

  return days.map((day, di) => {
    const row: Record<string, string | number | null> = { date: day };
    series.forEach((s, si) => {
      row[s.key] = filled[si][di];
    });
    return row;
  });
}

function CompareLegend({ series }: { series: CompareSeries[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {series.map((s) => {
        const thin = s.snapshots.length < MIN_POINTS;
        return (
          <span
            key={s.key}
            className={`flex min-w-0 items-center gap-1.5 text-xs ${
              thin ? "text-muted-foreground/60" : "text-muted-foreground"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: s.color, opacity: thin ? 0.4 : 1 }}
            />
            <span className="truncate">{s.name}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The single combined install chart for the compare page: cumulative installs
 * over time, one line per compared skill on a shared axis, so trajectory and
 * relative size read together. Below the per-line history threshold for every
 * skill it falls back to a ghost placeholder, matching the sidebar's
 * still-collecting state. Series without enough history are listed in the
 * legend (muted) but draw no line until they have points.
 */
export function CompareTrendChart({ series }: { series: CompareSeries[] }) {
  const drawable = useMemo(
    () => series.filter((s) => s.snapshots.length >= MIN_POINTS),
    [series],
  );
  const data = useMemo(() => buildCompareRows(drawable), [drawable]);

  if (drawable.length === 0) {
    return (
      <div>
        <CompareLegend series={series} />
        <CompareTrendGhost />
        <p className="mt-3 text-xs text-pretty text-muted-foreground">
          Not enough history yet. Installs are recorded daily, and the
          comparison fills in as the trend builds.
        </p>
      </div>
    );
  }

  return (
    <div>
      <CompareLegend series={series} />
      <div style={CHART_VARS}>
        <LineChart
          data={data}
          xDataKey="date"
          aspectRatio="5 / 2"
          animationDuration={0}
          margin={{ top: 16, right: 16, bottom: 30, left: 44 }}
        >
          <Grid horizontal />
          <YAxis numTicks={4} />
          {drawable.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              fadeEdges={false}
              animate={false}
            />
          ))}
          <XAxis numTicks={6} />
          <ChartTooltip
            panelStyle={TOOLTIP_PANEL_STYLE_INLINE}
            rows={(point) =>
              drawable
                .filter((s) => typeof point[s.key] === "number")
                .map((s) => ({
                  color: s.color,
                  label: s.name,
                  value: point[s.key] as number,
                }))
            }
          />
        </LineChart>
      </div>
    </div>
  );
}

/**
 * Loading placeholder for the compare chart. The compare data is the one
 * client-side fetch among our charts, so this is the only chart with a real
 * loading phase. It reserves the loaded layout's height (legend row + the 5/2
 * chart) and centers the house dot-matrix loader with a label, so the swap to
 * the real chart doesn't shift and brings no reveal animation. The loader's CSS
 * already drops to a static state under prefers-reduced-motion.
 */
export function CompareTrendSkeleton() {
  return (
    <div className="relative">
      {/* Invisible spacers hold the legend row + chart height so loading → loaded
          swaps in place. */}
      <div className="mb-5 h-4" />
      <div className="aspect-5/2 w-full" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        {/* The loader paints from currentColor, and its own `.dmxr-loader` rule
            pins that to currentColor — so the brand hue has to come from a parent,
            not a class on the loader itself. */}
        {/* <span className="text-primary"> */}
        <DotMatrixRipple size="lg" ariaLabel="Loading install history" />
        {/* </span> */}
        <p aria-hidden="true" className="text-sm text-muted-foreground">
          Loading install history
        </p>
      </div>
    </div>
  );
}

/** Faint two-line ghost for the compare chart's pre-history state. */
function CompareTrendGhost() {
  return (
    <svg
      viewBox="0 0 300 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-40 w-full mask-[linear-gradient(to_right,#000,#000_35%,transparent)]"
    >
      <path
        d="M0 92 C 40 88 70 70 110 64 C 150 58 190 40 240 30 C 270 24 288 22 300 20"
        fill="none"
        stroke="var(--compare-line-1)"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 104 C 40 102 80 96 120 86 C 160 76 200 72 240 62 C 270 56 288 54 300 52"
        fill="none"
        stroke="var(--compare-line-2)"
        strokeOpacity="0.3"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

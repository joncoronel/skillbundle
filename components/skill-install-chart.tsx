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

export type SkillInsights = {
  snapshots: { day: string; installs: number }[];
  installs: number;
  installRank: number | null;
  totalSkills: number | null;
  trendingRank: number | null;
  hotChange: number | null;
};

// Days of history before the time-series is worth charting. Below this the
// sidebar shows a "still collecting" note instead of a sparkline/chart, since
// skills.sh has no history to backfill — the series grows ~1 point/day.
export const MIN_POINTS = 7;

// Trailing window the sidebar sparkline draws. The query keeps ~180 days for the
// full "View details" chart, but the sparkline is a recent-momentum glance, so
// it shows just the last week (and reads alongside the "+N past 7d" stat above
// it). The dialog chart still gets the full series.
export const SPARKLINE_DAYS = 7;

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
 * Installs gained over the trailing ~7 days, measured from the earliest
 * snapshot still inside the window. Null until the window has two points.
 */
export function weekGain(snapshots: SkillInsights["snapshots"]) {
  if (snapshots.length < 2) return null;
  const latest = snapshots[snapshots.length - 1];
  const cutoff = toDate(latest.day).getTime() - 7 * 86_400_000;
  const start =
    [...snapshots].reverse().find((s) => toDate(s.day).getTime() <= cutoff) ??
    snapshots[0];
  const gain = latest.installs - start.installs;
  return gain > 0 ? gain : null;
}

export type SparklineHoverState = { value: number; day: string } | null;

/**
 * Compact cumulative-installs sparkline for the sidebar: just the line, no
 * axes/grid/box. When `onHover` is passed it reports the hovered point's total
 * + day (read off the chart's interaction state) so the surrounding UI can
 * scrub the headline number, and shows a crosshair + dot indicator — no tooltip
 * popover, which would dwarf a chart this small.
 */
export function InstallSparkline({
  points,
  onHover,
}: {
  points: SkillInsights["snapshots"];
  onHover?: (state: SparklineHoverState) => void;
}) {
  const data = useMemo(
    () => points.map((p) => ({ date: p.day, installs: p.installs })),
    [points],
  );
  return (
    <div style={CHART_VARS}>
      <LineChart
        data={data}
        xDataKey="date"
        aspectRatio="7 / 1"
        animationDuration={0}
        margin={{ top: 4, right: 3, bottom: 4, left: 3 }}
      >
        <Line
          dataKey="installs"
          stroke="var(--primary)"
          strokeWidth={1.5}
          fadeEdges={false}
          animate={false}
        />
        {onHover && (
          <>
            {/* Dot indicator only — no crosshair, and the box is hidden so we
                don't float a popover over a 40px chart. The value is surfaced
                in the sidebar via the hover bridge instead. */}
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
 * Trend sparkline that falls back to the ghost when there isn't enough history.
 * For surfaces with no headline number to scrub (e.g. compare columns).
 */
export function SkillSparkline({
  snapshots,
}: {
  snapshots: SkillInsights["snapshots"];
}) {
  return snapshots.length >= MIN_POINTS ? (
    <InstallSparkline points={snapshots} />
  ) : (
    <InstallSparklineGhost />
  );
}

/** Pipes the hovered point off the chart's interaction state into `onHover`. */
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
          <SeriesBar animate={false} dataKey="daily" fill={BAR_FILL} radius={4} />
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
        <span className="size-2.5 rounded-[3px]" style={{ background: BAR_FILL }} />
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

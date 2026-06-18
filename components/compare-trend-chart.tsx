"use client";

import { useMemo } from "react";
import { Line } from "@/components/charts/line";
import { LineChart } from "@/components/charts/line-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import {
  CHART_VARS,
  MIN_POINTS,
  seriesSummary,
  toDate,
  type SkillInsights,
} from "@/components/skill-chart-shared";

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
    // Date pinned to UTC noon, not the raw "YYYY-MM-DD" — see toDate. The chart
    // parses bare strings as UTC midnight, which labels a day early west of UTC.
    const row: Record<string, string | number | Date | null> = {
      date: toDate(day),
    };
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
      <div
        style={CHART_VARS}
        role="img"
        aria-label={`Installs over time. ${drawable
          .map((s) => `${s.name} ${seriesSummary(s.snapshots)}`)
          .join("; ")}.`}
      >
        <LineChart
          data={data}
          xDataKey="date"
          aspectRatio="5 / 2"
          animationDuration={400}
          margin={{ top: 16, right: 16, bottom: 44, left: 44 }}
        >
          <Grid horizontal />
          <YAxis numTicks={4} />
          {drawable.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              fadeEdges={true}
            />
          ))}
          {/* One label per data row at its x — steadier than "domain" mode when
              the shared series is short or sparse. */}
          <XAxis numTicks={6} tickMode="data" />
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
        <DotMatrixRipple size="lg" ariaLabel="Loading install history" />
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

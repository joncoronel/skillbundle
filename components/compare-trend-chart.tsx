"use client";

import { useMemo } from "react";
import { defineChart, lineY } from "@tanstack/charts";
import { scalePoint } from "@tanstack/charts/scales/point";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import {
  CHART_REVEAL_CLASS,
  INITIAL_WIDTH,
  useChartHostProps,
} from "@/components/charts/chart";
import {
  AXIS_TICK_LABELS,
  evenlySpaced,
  CHART_THEME,
  datePillOffset,
  AXIS_LABEL_MARGIN_WITH_Y_AXIS,
  AXIS_LABEL_PADDING_WITH_Y_AXIS,
} from "@/components/charts/chart-theme";
import {
  ChartHoverOverlay,
  useChartHoverOverlay,
} from "@/components/charts/chart-hover-overlay";
import { focusCrosshair } from "@/components/charts/focus-crosshair";
import { CHART_TOOLTIP } from "@/components/charts/chart-tooltip";
import {
  ChartTooltipPanel,
  tooltipRows,
} from "@/components/charts/chart-tooltip-panel";
import { CHART_CURVE, HOVER_DIM } from "@/components/charts/series-state";
import { fadeEdgesGradient, fadeEdgesId } from "@/components/charts/fade-edges";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import {
  compactCount,
  dayLabel,
  dayLabelLong,
  intFmt,
  MIN_POINTS,
  seriesSummary,
  type SkillInsights,
} from "@/components/skill-chart-shared";

// One categorical color per compared skill, anchored on the brand accent. The
// compare page maps each column to its index here so the column header dot,
// legend swatch, and line all carry the same hue. Capped at the 3-column max.
export const COMPARE_LINE_COLORS = [
  "var(--compare-line-1)",
  "var(--compare-line-2)",
  "var(--compare-line-3)",
];

/** The old chart's `XAxis numTicks={6}`; this chart is wider than the dialog's. */
const COMPARE_TICK_COUNT = 6;

const LINE_ID = "installs";

export type CompareSeries = {
  /** Stable series key for the merged rows (e.g. "s0") — avoids odd chars. */
  key: string;
  name: string;
  color: string;
  snapshots: SkillInsights["snapshots"];
};

type CompareRow = {
  day: string;
  series: string;
  name: string;
  color: string;
  installs: number;
};

/**
 * Flattens each skill's daily snapshots onto a shared date axis: the union of
 * all days, each series carried forward over a skipped day and back-filled
 * before its first point, so every line spans the axis with no gaps. Cumulative
 * installs are monotonic, so carry-forward is the correct fill for a missed
 * cron day; the leading back-fill only affects a skill that started recording
 * later than the others (a short flat lead-in).
 *
 * One row per series per day (long form) rather than one wide row per day: it
 * is what `lineY`'s `z` grouping consumes, and it drops the wide-row shape's
 * `Record<string, unknown>` indexing in favour of a typed row.
 */
function buildCompareRows(series: CompareSeries[]): CompareRow[] {
  const days = Array.from(
    new Set(series.flatMap((s) => s.snapshots.map((p) => p.day))),
  ).sort();

  return series.flatMap((s) => {
    const byDay = new Map(s.snapshots.map((p) => [p.day, p.installs] as const));
    let last: number | null = null;
    const forward = days.map((d) => {
      const v = byDay.get(d);
      if (v != null) last = v;
      return last;
    });
    const first = forward.find((v) => v != null) ?? 0;

    return days.map((day, i) => ({
      day,
      series: s.key,
      name: s.name,
      color: s.color,
      installs: forward[i] ?? first,
    }));
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

  // Above `definition`, which reads it for the axis tick candidates.
  const days = useMemo(
    () =>
      Array.from(
        new Set(drawable.flatMap((s) => s.snapshots.map((p) => p.day))),
      ).sort(),
    [drawable],
  );

  const definition = useMemo(() => {
    const rows = buildCompareRows(drawable);

    return defineChart({
      marks: [
        lineY(rows, {
          id: LINE_ID,
          x: "day",
          y: "installs",
          // `z` splits the flat rows into one path per skill. Each path paints
          // with its own fade gradient, declared below from the colour the
          // compare page already assigned — so the line, the column header dot
          // and the legend swatch cannot drift apart.
          z: "series",
          stroke: (row: CompareRow) => `url(#${fadeEdgesId(row.series)})`,
          strokeWidth: 2,
          curve: CHART_CURVE,
          states: [HOVER_DIM],
        }),
        // Last, so it paints over the lines rather than under them.
        focusCrosshair(days.length),
      ],
      // Days are discrete samples, one per cron run, so they are positions on a
      // point scale rather than instants on a time scale. This also keeps every
      // tick landing on a real data point, which is what the old chart's
      // `tickMode="data"` was for.
      x: {
        scale: scalePoint,
        axis: {
          line: false,
          ticks: {
            size: 0,
            padding: AXIS_LABEL_PADDING_WITH_Y_AXIS,
            format: dayLabel,
            // The old chart's `numTicks={6}`. A point scale offers every day as
            // a candidate and ignores `count`, so without this the axis prints
            // one label per day that fits — nearly twice as many as before.
            values: evenlySpaced(days, COMPARE_TICK_COUNT),
          },
          tickLabels: AXIS_TICK_LABELS,
        },
      },
      y: {
        // Zero-based with a tenth of headroom, as the old chart's y-domain was.
        // Letting the scale infer from the data starts the axis near the
        // smallest series, which exaggerates the gaps between skills — the one
        // thing this chart exists to compare honestly.
        // A configured instance, not a factory: a factory infers its domain from
        // the marks and would discard the zero below.
        scale: scaleLinear().domain([
          0,
          rows.reduce((max, r) => Math.max(max, r.installs), 0) * 1.1,
        ]),
        nice: true,
        grid: true,
        axis: {
          line: false,
          // Abbreviated like the install stats directly below the chart, so the
          // axis and the tiles read in the same units.
          ticks: { count: 4, size: 0, format: compactCount },
          tickLabels: AXIS_TICK_LABELS,
        },
      },
      gradients: drawable.map((s) =>
        fadeEdgesGradient(fadeEdgesId(s.key), s.color),
      ),
      margin: { top: 16, right: 16, bottom: AXIS_LABEL_MARGIN_WITH_Y_AXIS },
      theme: CHART_THEME,
      tooltip: CHART_TOOLTIP,
      focus: "group-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      // The overlay owns the gesture and every cursor visual; see
      // `chart-hover-overlay`. Without `focusRing: false` the chart paints its
      // own marker underneath ours — two dots, only one of them moving.
      focusRing: false,
      pointer: false,
    });
  }, [drawable, days]);

  const hostProps = useChartHostProps();

  const overlay = useChartHoverOverlay({
    markers: useMemo(
      () =>
        drawable.map((s) => ({
          key: s.key,
          color: s.color,
          label: s.name,
        })),
      [drawable],
    ),
    labels: useMemo(() => days.map(dayLabel), [days]),
  });

  if (drawable.length === 0) {
    return (
      <div>
        <CompareLegend series={series} />
        <CompareTrendGhost />
        <p className="mt-3 text-xs text-muted-foreground">
          Not enough history yet. Installs are recorded daily, and the
          comparison fills in as the trend builds.
        </p>
      </div>
    );
  }

  return (
    <div>
      <CompareLegend series={series} />
      <ChartHoverOverlay
        controller={overlay}
        pillOffset={datePillOffset(
          AXIS_LABEL_MARGIN_WITH_Y_AXIS,
          AXIS_LABEL_PADDING_WITH_Y_AXIS,
        )}
      >
        <RendererChart
          {...hostProps}
          initialWidth={INITIAL_WIDTH.compare}
          ariaLabel={`Installs over time. ${drawable
            .map((s) => `${s.name} ${seriesSummary(s.snapshots)}`)
            .join("; ")}.`}
          aspectRatio={5 / 2}
          className={CHART_REVEAL_CLASS}
          definition={definition}
          onFocusChange={overlay.onFocusChange}
          renderTooltipBody={({ points }) => (
            <ChartTooltipPanel
              rows={tooltipRows(overlay.markers, points, (point) =>
                intFmt(point.datum.installs),
              )}
              title={dayLabelLong(points[0]?.datum.day ?? "")}
            />
          )}
          onRender={overlay.onRender}
        />
      </ChartHoverOverlay>
    </div>
  );
}

/**
 * Loading placeholder for the compare chart. The compare data is the one
 * client-side fetch among our charts, so this is the only chart with a real
 * loading phase. It reserves the loaded layout's height (legend row + the 5/2
 * chart) and centers the house dot-matrix loader with a label, so the swap to
 * the real chart doesn't shift. The loader's CSS already drops to a static state
 * under prefers-reduced-motion.
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

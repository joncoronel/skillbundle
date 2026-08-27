"use client";

import { useMemo } from "react";
import { barY, defineChart, lineY } from "@tanstack/charts";
import { scalePoint } from "@tanstack/charts/scales/point";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import {
  INITIAL_WIDTH,
  useChartHostProps,
  useUntransformedHost,
} from "@/components/charts/chart";
import {
  AXIS_TICK_COUNT,
  AXIS_TICK_LABELS,
  evenlySpaced,
  CHART_THEME,
  datePillOffset,
  AXIS_LABEL_MARGIN,
  AXIS_LABEL_PADDING,
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
import {
  BAR_UNFOCUSED_DIM,
  CHART_CURVE,
  HOVER_DIM,
} from "@/components/charts/series-state";
import { fadeEdgesGradient, fadeEdgesId } from "@/components/charts/fade-edges";
import {
  dayLabel,
  dayLabelLong,
  intFmt,
  seriesSummary,
  type SkillInsights,
} from "@/components/skill-chart-shared";

// Daily bars are the secondary series: the design system's neutral fill,
// softened so the Signal Blue total line stays the one accent.
const BAR_FILL = "color-mix(in oklch, var(--neutral) 65%, transparent)";

/**
 * How long the bars' entrance takes to sweep from the first column to the last.
 *
 * Replaces the library's automatic bar stagger, which spans
 * `baseDuration * 0.4`. `baseDuration` is the tween duration, or a flat 1100
 * when the transition is a spring — and ours is (`FOCUS_SPRING`), so the
 * automatic span was 440ms with no way to tune it short of changing the
 * renderer's transition, which also feeds the tooltip. Measured, that put the
 * last bar's start 440ms in and the whole entrance at ~720ms, which reads
 * leisurely against a dialog that opens in 200.
 *
 * Divided by `datumCount`, exactly as the library's own is. A flat
 * milliseconds-per-bar — what `stagger()` from `@tanstack/charts/motion/definition`
 * writes — is linear in the series length, so a skill with 200 snapshots would
 * sweep for ten times as long as one with 20 rather than the same span.
 */
const ENTRANCE_STAGGER_MS = 180;

/**
 * Top of the y domain, as a multiple of the largest cumulative total.
 */
const Y_HEADROOM = 1.08;

/**
 * The domain ceiling, floored so it is never zero.
 *
 * `hasChart` gates the dialog on snapshot COUNT, not on values, so a skill with
 * two or more snapshots and no installs recorded yet reaches here with
 * `totalMax === 0`. Left alone that gives `domain([0, 0])` and stacks all five
 * grid rules on one line.
 */
function yDomainTop(totalMax: number) {
  return Math.max(1, totalMax * Y_HEADROOM);
}

const LINE_ID = "total";
const BAR_ID = "daily";

// One dot per series, keyed by the `z` group each mark declares below.
const HOVER_MARKERS = [
  {
    key: LINE_ID,
    color: "var(--primary)",
    label: "Total installs",
  },
  {
    key: BAR_ID,
    color: BAR_FILL,
    // Same recipe as the bars, against the panel's foreground rather than the
    // page's: `--neutral` is a dark tone and the panel is near-black.
    swatch: "color-mix(in oklch, currentColor 65%, transparent)",
    label: "Daily installs",
  },
];

/**
 * The full install history: cumulative total (line) + daily gained (bars) on
 * independent vertical ranges. Lives in the chart dialog where it has room; the
 * sidebar shows the sparkline and opens this on demand.
 *
 * Kept in its own file (the heavy bar path) so it only ships to the skill page,
 * never the compare page — and so it can be swapped to `next/dynamic` later,
 * loading on dialog-open, without touching the sparkline.
 */
export function InstallChart({ insights }: { insights: SkillInsights }) {
  const { snapshots } = insights;

  const overlay = useChartHoverOverlay({
    labels: useMemo(() => snapshots.map((s) => dayLabel(s.day)), [snapshots]),
    markers: HOVER_MARKERS,
  });

  // This chart's scene is measured through whatever transform its dialog is
  // mid-animation on, so the dialog's entrance deliberately carries no scale
  // (`skill-record.tsx`). Nothing in the type system says so; this does.
  useUntransformedHost(overlay.hostRef, "InstallChart");

  const definition = useMemo(() => {
    // One row per day: `total` (cumulative, the line) and `daily` (gained, the
    // bars). Day-over-day can dip negative on a correction; floor at 0.
    const rows = snapshots.map((s, i) => ({
      day: s.day,
      total: s.installs,
      daily: i === 0 ? 0 : Math.max(0, s.installs - snapshots[i - 1].installs),
    }));

    // A cumulative total dwarfs any single day's gain — often by two or three
    // orders of magnitude — so on one shared range the bars would be a flat
    // line along the axis. The bars are therefore measured against their own
    // peak and rescaled into the totals' range. The old chart got the same
    // result from a second y-axis, but neither axis was ever labelled — the two
    // scales only ever existed to let each series fill the plot — so pre-scaling
    // the value is equivalent and keeps this to one chart.
    //
    // `barPlot` is the plotted height; `daily` stays intact and is what the
    // tooltip reports.
    const totalMax = rows.reduce((max, r) => Math.max(max, r.total), 0);
    const dailyMax = rows.reduce((max, r) => Math.max(max, r.daily), 0);
    const barRatio = dailyMax > 0 ? totalMax / dailyMax : 0;

    return defineChart({
      marks: [
        barY(rows, {
          id: BAR_ID,
          x: "day",
          // Scaled in the accessor rather than in a mapped array so both marks
          // read the same row objects — the tooltip then reports true values
          // off whichever point the group hands it.
          y: (r) => r.daily * barRatio,
          // Both marks need distinct group identity: grouped focus reduces
          // points that share a group to one member, and with the default
          // (null) group the bar would swallow the line, taking the hover
          // highlight and the line's tooltip row with it.
          z: () => BAR_ID,
          fill: BAR_FILL,
          fillOpacity: 1,
          radius: 4,
          maxThickness: 26,
          states: [BAR_UNFOCUSED_DIM],
          // Only the entrance is retimed; returning `undefined` for every other
          // phase leaves the library's own timing in place rather than pinning
          // it to zero.
          motion: ({ phase, datumIndex, datumCount }) =>
            phase === "enter"
              ? {
                  delay:
                    (ENTRANCE_STAGGER_MS * datumIndex) /
                    Math.max(1, datumCount),
                }
              : undefined,
        }),
        lineY(rows, {
          id: LINE_ID,
          x: "day",
          y: "total",
          z: () => LINE_ID,
          curve: CHART_CURVE,
          // Painted through the edge-fade gradient, as the old chart's line was
          // (`fadeEdges` defaulted to true on its `Line`). The overlay's
          // highlight band stays solid — see the clone in `chart-hover-overlay`.
          stroke: `url(#${fadeEdgesId(LINE_ID)})`,
          strokeOpacity: 1,
          strokeWidth: 2,
          states: [HOVER_DIM],
        }),
        focusCrosshair(rows.length),
      ],
      // A point scale, not a band: it puts the first and last day ON the plot's
      // edges, so the line, its marker, the crosshair, the date pill and the
      // labels all land at the same x. The old chart got there by running two
      // scales at once — bars on a band, line and labels on a time scale — and
      // that split is visible on a short series: its bars sat up to half a band
      // away from the labels naming them. One scale for everything is the same
      // look without the disagreement.
      //
      // The cost is bar width. Off a band the mark has no bandwidth to read, so
      // `inferBandwidth` gives it `minimumSpacing * 0.8` — a hard ceiling, since
      // `inset` clamps at zero — against the old chart's 0.88 of the column.
      // About a pixel at the densities these charts see.
      x: {
        scale: scalePoint,
        axis: {
          line: false,
          ticks: {
            size: 0,
            padding: AXIS_LABEL_PADDING,
            format: dayLabel,
            // The old chart's `numTicks={5}` on a `tickMode="data"` axis: five
            // labels pinned to real rows, first and last included. A point
            // scale offers every category as a candidate and ignores `count`,
            // so the candidates are chosen here. Thinning still runs on top,
            // which is what keeps a narrow chart from crowding.
            values: evenlySpaced(
              rows.map((r) => r.day),
              AXIS_TICK_COUNT,
            ),
          },
          tickLabels: AXIS_TICK_LABELS,
        },
      },
      y: {
        // An explicit domain rather than `nice`, because nothing reads this
        // axis: both series share it and it describes neither on its own (see
        // `barRatio`), so round numbers buy nothing and a known top is worth
        // more. The headroom keeps the last point of the cumulative line — its
        // maximum, and the top of the tallest bar — off the plot's edge, where
        // the stroke and the focus marker would be clipped.
        scale: scaleLinear().domain([0, yDomainTop(totalMax)]),
        grid: true,
        // Unlabelled, but the ticks still set how many dashed rules cross the
        // plot — the old `Grid`'s `numTicksRows={5}`. Explicit values rather
        // than `count`, which d3 rounds to a human-friendly step and overshoots
        // on this domain. The topmost rule lands on the plot's top edge, where
        // the old chart drew its fifth. See docs/charts.md for both.
        axis: {
          line: false,
          ticks: {
            size: 0,
            values: Array.from(
              { length: AXIS_TICK_COUNT },
              (_, i) => (yDomainTop(totalMax) * i) / (AXIS_TICK_COUNT - 1),
            ),
          },
          tickLabels: false,
        },
      },
      gradients: [fadeEdgesGradient(fadeEdgesId(LINE_ID), "var(--primary)")],
      margin: { top: 16, right: 14, left: 14, bottom: AXIS_LABEL_MARGIN },
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
  }, [snapshots]);

  const hostProps = useChartHostProps({ entrance: true });

  return (
    <div>
      <Legend />
      <ChartHoverOverlay
        controller={overlay}
        pillOffset={datePillOffset(AXIS_LABEL_MARGIN, AXIS_LABEL_PADDING)}
      >
        <RendererChart
          {...hostProps}
          initialWidth={INITIAL_WIDTH.dialog}
          ariaLabel={`Install history: ${seriesSummary(snapshots)}.`}
          aspectRatio={5 / 2}
          definition={definition}
          onFocusChange={overlay.onFocusChange}
          renderTooltipBody={({ points }) => (
            <ChartTooltipPanel
              rows={tooltipRows(HOVER_MARKERS, points, (point, marker) =>
                marker.key === LINE_ID
                  ? intFmt(point.datum.total)
                  : `+${intFmt(point.datum.daily)}`,
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

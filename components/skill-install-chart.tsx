"use client";

import { useMemo } from "react";
import { barY, defineChart, lineY } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import { INITIAL_WIDTH, useChartHostProps } from "@/components/charts/chart";
import {
  AXIS_TICK_LABELS,
  CHART_THEME,
  datePillOffset,
  AXIS_LABEL_MARGIN,
  AXIS_LABEL_PADDING,
} from "@/components/charts/chart-theme";
import {
  ChartHoverOverlay,
  useChartHoverOverlay,
} from "@/components/charts/chart-hover-overlay";
import {
  BAR_UNFOCUSED_DIM,
  CHART_CURVE,
  HOVER_DIM,
} from "@/components/charts/series-state";
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
        }),
        lineY(rows, {
          id: LINE_ID,
          x: "day",
          y: "total",
          z: () => LINE_ID,
          curve: CHART_CURVE,
          stroke: "var(--primary)",
          strokeOpacity: 1,
          strokeWidth: 2,
          states: [HOVER_DIM],
        }),
      ],
      // A band scale, not a time scale: there is one row per day and the bars
      // need a band to sit in. Lines plot at band centres, so the total tracks
      // the middle of each day's bar. This is also what the old chart's
      // `tickMode="data"` was emulating on a time axis.
      x: {
        scale: () => scaleBand<string>().padding(0.35),
        axis: {
          line: false,
          ticks: { size: 0, padding: AXIS_LABEL_PADDING, format: dayLabel },
          tickLabels: AXIS_TICK_LABELS,
        },
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        // Both series share this range but it describes neither on its own
        // (see `barRatio`), so it stays unlabelled, as it always has been.
        axis: false,
      },
      margin: { top: 16, right: 14, left: 14, bottom: AXIS_LABEL_MARGIN },
      theme: CHART_THEME,
      focus: "group-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      // The overlay owns the gesture and every cursor visual; see
      // `chart-hover-overlay`. Without `focusRing: false` the chart paints its
      // own marker underneath ours — two dots, only one of them moving.
      focusRing: false,
      pointer: false,
    });
  }, [snapshots]);

  const hostProps = useChartHostProps();
  const overlay = useChartHoverOverlay({
    labels: useMemo(() => snapshots.map((s) => dayLabel(s.day)), [snapshots]),
    markers: HOVER_MARKERS,
  });

  return (
    <div>
      <Legend />
      <ChartHoverOverlay
        controller={overlay}
        pillOffset={datePillOffset(AXIS_LABEL_MARGIN, AXIS_LABEL_PADDING)}
        tooltip={{
          title: (index) => dayLabelLong(snapshots[index]?.day ?? ""),
          value: (point, marker) => {
            const row = point.datum as { total: number; daily: number };
            return marker.key === LINE_ID
              ? intFmt(row.total)
              : `+${intFmt(row.daily)}`;
          },
        }}
      >
        <RendererChart
          {...hostProps}
          initialWidth={INITIAL_WIDTH.dialog}
          ariaLabel={`Install history: ${seriesSummary(snapshots)}.`}
          aspectRatio={5 / 2}
          definition={definition}
          onRender={overlay.onRender}
          style={{
            ...hostProps.style,
          }}
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

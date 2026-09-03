"use client";

import { useMemo } from "react";
import { barY, defineChart, lineY } from "@tanstack/charts";
import { scaleUtc } from "d3-scale";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import {
  INITIAL_WIDTH,
  chartHostProps,
  useUntransformedHost,
} from "@/components/charts/chart";
import {
  AXIS_TICK_COUNT,
  AXIS_TICK_LABELS,
  calendarTicks,
  CHART_THEME,
  datePillOffset,
  X_AXIS_LABEL_MARGIN,
  X_AXIS_LABEL_PADDING,
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
  chartMotionEntrance,
  RANGE_TWEEN,
} from "@/components/charts/chart-motion";
import {
  dayLabel,
  dayLabelAt,
  dayLabelLong,
  intFmt,
  seriesSummary,
  toDate,
  type SkillInsights,
} from "@/components/skill-chart-shared";
import {
  RangeBrush,
  RangeControl,
  useDayRange,
} from "@/components/skill-install-range";

// Daily bars are the secondary series: the design system's neutral fill,
// softened so the Signal Blue total line stays the one accent.
const BAR_FILL = "color-mix(in oklch, var(--neutral) 65%, transparent)";

/**
 * How long the bars' entrance sweeps from the first column to the last.
 *
 * Replaces the library's automatic stagger, which spans `baseDuration * 0.4`
 * and is untunable short of changing the renderer's transition (which also
 * feeds the tooltip). Measured at 440ms to the last bar's start and ~720ms
 * total, leisurely against a dialog that opens in 200.
 *
 * Divided by `datumCount`, as the library's own is: a flat ms-per-bar is
 * linear in series length, so 200 snapshots would sweep ten times as long
 * as 20 rather than over the same span.
 */
const ENTRANCE_STAGGER_MS = 180;

/** Top of the y domain, as a multiple of the largest cumulative total. */
const Y_HEADROOM = 1.08;

/**
 * The domain ceiling, floored so it is never zero. `hasChart` gates the dialog
 * on snapshot COUNT, so a skill with snapshots and no installs yet arrives with
 * `totalMax === 0`, and `domain([0, 0])` stacks all five grid rules on one line.
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

  // Every row the series has, with `daily` already resolved.
  //
  // Built ONCE over the whole series and only then windowed, which is the one
  // ordering that works: `daily` is a difference against the previous row, so
  // slicing first would leave the window's opening day reporting a false `+0`
  // while the day that actually precedes it sits right there in `snapshots`.
  // The `i === 0` zero is honest only at the true start of recorded history.
  const allRows = useMemo(
    () =>
      snapshots.map((s, i) => ({
        day: s.day,
        // The x channel is now a real instant, not an ordinal slot. `day` stays
        // for the tooltip title, the overlay labels and the range plumbing,
        // which all speak in calendar days.
        date: toDate(s.day),
        total: s.installs,
        // Day-over-day can dip negative on a correction; floor at 0.
        daily:
          i === 0 ? 0 : Math.max(0, s.installs - snapshots[i - 1].installs),
      })),
    [snapshots],
  );

  // The whole range machine, shared with the compare chart. Opens NARROWED, on
  // the widest finite preset: the strip below carries the full series, so the
  // default hides nothing and starts on the readable end, where bars are ~15px
  // wide instead of the 5.4px they collapse to across a full 90 days. 7d would
  // be a sliver rather than a window.
  const {
    presets,
    rangeable,
    windowRows: rows,
    committedRange,
    dragging,
    touched,
    commitRange,
  } = useDayRange(allRows, { open: "narrowed" });

  // One neutral line for the strip. Neutral because this chart's own line is
  // already the accent, and the strip indexes the data rather than restating it.
  const brushSeries = useMemo(
    () => [
      {
        key: LINE_ID,
        color: "var(--muted-foreground)",
        values: allRows.map((row) => ({ date: row.date, value: row.total })),
      },
    ],
    [allRows],
  );

  const overlay = useChartHoverOverlay({
    labels: useMemo(() => rows.map((r) => dayLabel(r.day)), [rows]),
    markers: HOVER_MARKERS,
  });

  // This chart's scene is measured through whatever transform its dialog is
  // mid-animation on, so the dialog's entrance deliberately carries no scale
  // (`skill-record.tsx`). Nothing in the type system says so; this does.
  useUntransformedHost(overlay.hostRef, "InstallChart");

  const definition = useMemo(() => {
    // A cumulative total dwarfs a single day's gain by two or three orders of
    // magnitude, so on one shared range the bars flatten onto the axis. Each
    // series gets its own vertical scale against its own peak. Neither is
    // labelled, which is why two scales are honest here where two AXES would
    // not be.
    const totalMax = rows.reduce((max, r) => Math.max(max, r.total), 0);
    const dailyMax = rows.reduce((max, r) => Math.max(max, r.daily), 0);

    return defineChart({
      marks: [
        barY(rows, {
          id: BAR_ID,
          x: "date",
          // The true value, on its own scale. Both marks read the same rows,
          // so the tooltip reports real numbers whichever point it is handed.
          y: "daily",
          yScale: BAR_ID,
          // Distinct group identity, both marks: grouped focus reduces a
          // shared group to one member, so on the default null group the bar
          // swallows the line and its tooltip row.
          z: () => BAR_ID,
          fill: BAR_FILL,
          fillOpacity: 1,
          radius: 4,
          maxThickness: 26,
          states: [BAR_UNFOCUSED_DIM],
          // The opening sweep, then snappy for everything after it.
          motion: ({ phase, datumIndex, datumCount }) =>
            phase === "enter" && !touched
              ? {
                  delay:
                    (ENTRANCE_STAGGER_MS * datumIndex) /
                    Math.max(1, datumCount),
                }
              : { transition: RANGE_TWEEN },
        }),
        lineY(rows, {
          id: LINE_ID,
          x: "date",
          y: "total",
          z: () => LINE_ID,
          curve: CHART_CURVE,
          // Through the edge-fade gradient, as the old chart's line was. The
          // overlay's highlight band stays solid; see `chart-hover-overlay`.
          stroke: `url(#${fadeEdgesId(LINE_ID)})`,
          strokeOpacity: 1,
          strokeWidth: 2,
          states: [HOVER_DIM],
          // Travels with the bars rather than trailing them on the renderer's
          // spring; the entrance keeps the library's own grow from the baseline.
          motion: ({ phase }) =>
            phase === "enter" && !touched
              ? undefined
              : { transition: RANGE_TWEEN },
        }),
        focusCrosshair(rows.length),
      ],
      scales: {
        // A UTC time scale, domained explicitly rather than by factory: the
        // domain IS the visible window. It was a point scale until the range
        // control landed, and both are nonband, so bars measure identically.
        // What the time scale adds is calendar-aware ticks, which keep their
        // identity as the window moves (`calendarTicks`). The one behavioural
        // difference: a MISSING snapshot is now a gap rather than an even step.
        x: {
          scale: scaleUtc().domain([rows[0].date, rows[rows.length - 1].date]),
          axis: {
            line: false,
            ticks: {
              size: 0,
              padding: X_AXIS_LABEL_PADDING,
              format: dayLabelAt,
              // Anchored to the series' LAST day, which never moves, so a
              // tick that stays visible keeps its key and travels. The old
              // index-picked ticks churned on every frame of a drag.
              values: calendarTicks(
                rows[0].date,
                rows[rows.length - 1].date,
                allRows[allRows.length - 1].date,
                AXIS_TICK_COUNT,
              ),
            },
            tickLabels: {
              ...AXIS_TICK_LABELS,
              // Now that a label survives a window change, it has somewhere to
              // travel to. Without this the renderer's spring still applies but
              // reads as a jump on a label that only moves a few pixels.
              motion: { transition: { type: "tween", duration: 220 } },
            },
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
        // The bars' own vertical range, so a daily gain three orders of
        // magnitude below the cumulative total still fills the plot. Same
        // headroom as `y`, which is what makes the tallest bar land exactly
        // where the old pre-scaled value put it.
        //
        // Draws nothing itself. Both defaults are on: a second axis would
        // claim margin and state a number this chart deliberately does not,
        // and a second grid would cross the five rules already there.
        [BAR_ID]: {
          channel: "y",
          scale: scaleLinear().domain([0, yDomainTop(dailyMax)]),
          axis: false,
          grid: false,
        },
      },
      gradients: [fadeEdgesGradient(fadeEdgesId(LINE_ID), "var(--primary)")],
      margin: { top: 16, right: 14, left: 14, bottom: X_AXIS_LABEL_MARGIN },
      theme: CHART_THEME,
      tooltip: CHART_TOOLTIP,
      focus: "group-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      // The overlay owns the gesture and every cursor visual. Without this
      // the chart paints its own marker under ours: two dots, one moving.
      focusRing: false,
      pointer: false,
    });
  }, [rows, allRows, touched]);

  const hostProps = chartHostProps(chartMotionEntrance);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Legend />
        {rangeable && committedRange && (
          <RangeControl
            rows={allRows}
            presets={presets}
            range={committedRange}
            // A preset is always a commit; only the brush previews.
            onRangeChange={(next) => commitRange(next)}
          />
        )}
      </div>
      <ChartHoverOverlay
        controller={overlay}
        // Stands down mid-drag: the strip has the pointer, so this chart's
        // hover state would go stale.
        disabled={dragging}
        pillOffset={datePillOffset(X_AXIS_LABEL_MARGIN, X_AXIS_LABEL_PADDING)}
      >
        <RendererChart
          {...hostProps}
          initialWidth={INITIAL_WIDTH.dialog}
          ariaLabel={`Install history: ${seriesSummary(
            rows.map((r) => ({ day: r.day, installs: r.total })),
          )}.`}
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
      {rangeable && committedRange && (
        // Held off the plot so the strip reads as a separate instrument, not
        // an unlabelled second series under the chart's own x labels. Space
        // alone does it; a rule as well was one line too many here.
        <div className="mt-6">
          <RangeBrush
            days={allRows}
            series={brushSeries}
            // The Stats tab puts this chart in normal page flow, so the scrim
            // dims with the page tone. It was `--surface-5` when the chart
            // lived in the record card's dialog — change it again if the chart
            // is ever re-homed onto a raised surface.
            surface="var(--background)"
            // The COMMITTED range: the live drag would reset D3's anchor.
            range={committedRange}
            onRangeChange={commitRange}
          />
        </div>
      )}
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

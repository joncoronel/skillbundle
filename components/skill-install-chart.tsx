"use client";

import { useCallback, useMemo, useState } from "react";
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
  dayLabelLong,
  intFmt,
  MIN_POINTS,
  seriesSummary,
  toDate,
  type SkillInsights,
} from "@/components/skill-chart-shared";
import {
  fullRange,
  usablePresets,
  RangeBrush,
  RangeControl,
  type DayRange,
} from "@/components/skill-install-range";

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

  const presets = usablePresets(allRows);
  // Nothing to narrow (a short series): no control, no strip, and the chart
  // renders exactly as it did before the range feature existed.
  const rangeable = presets.length > 0;

  // Opens on the WIDEST finite preset, not the narrowest. 7d over a 71-day
  // extent leaves a selection about a tenth of the strip, which reads as a
  // sliver rather than a window; 30d is a window you can see, and is nearer the
  // "how have the last couple of months gone" this chart is usually opened to
  // answer.
  //
  // Narrowed rather than full by default, because the strip below carries the
  // whole series — so the default hides nothing, and it starts on the readable
  // end, where bars are ~15px wide instead of the 5.4px they collapse to across
  // a full 90 days.
  const [range, setRange] = useState<DayRange>(() =>
    rangeable ? presets[presets.length - 1].range : fullRange(allRows),
  );

  // Whether the reader has changed the window yet.
  //
  // `phase === "enter"` fires for BOTH the first paint and every bar arriving on
  // a later range change, and the two want opposite timings: the first is the
  // staggered sweep the dialog opens on, the second has to keep up with a
  // gesture the pointer already finished. Widening the range makes most bars
  // enter, so without this the whole entrance replayed on every brush drag —
  // which is what read as sluggish.
  //
  // State set from the commit path, not a ref read at animation time: a ref
  // cannot be read during render, and this is exact where a "has the entrance
  // finished by now" timer would only be a guess. It flips on the same commit
  // that changes the range, so the definition was rebuilding anyway.
  const [touched, setTouched] = useState(false);

  // The window being dragged, held apart from the committed one.
  //
  // Both are needed because they answer to different owners. The BRUSH's
  // controlled value has to stay still for the length of a gesture — rewriting
  // it per frame rebuilds its definition under D3 and resets the drag anchor.
  // The CHART above has to move per frame, or the plot sits frozen until you
  // let go. One piece of state cannot be both, so a preview drives the plot and
  // the committed range drives the brush.
  const [preview, setPreview] = useState<DayRange | null>(null);

  const commitRange = useCallback((next: DayRange, committed = true) => {
    if (!committed) {
      setPreview(next);
      return;
    }
    setTouched(true);
    setPreview(null);
    setRange(next);
  }, []);

  // What the plot draws: the live drag when there is one, the settled range
  // otherwise.
  const shownRange = preview ?? range;

  // The window, guarded on two counts.
  //
  // A skill whose snapshots arrive or extend while the dialog is open would
  // otherwise hold a range naming days that no longer bound the series. And the
  // brush can be dragged shut onto a single day, which leaves the x scale with
  // a zero-width domain — two points at the same instant, nothing to map. A
  // window is never allowed below `MIN_POINTS` rows; collapsing it just walks
  // the start back far enough to keep a segment.
  const clampedRange = useMemo(() => {
    const all = fullRange(allRows);
    const startIdx = allRows.findIndex((row) => row.day === shownRange.start);
    const endIdx = allRows.findIndex((row) => row.day === shownRange.end);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return all;
    if (endIdx - startIdx + 1 >= MIN_POINTS) return shownRange;
    const widenedStart = Math.max(0, endIdx - (MIN_POINTS - 1));
    // Only possible when the series itself is shorter than `MIN_POINTS`, which
    // `hasChart` already prevents — but the fallback costs one comparison.
    if (endIdx - widenedStart + 1 < MIN_POINTS) return all;
    return { start: allRows[widenedStart].day, end: shownRange.end };
  }, [allRows, shownRange]);

  // The brush's own value, clamped but never carrying the preview.
  const committedRange = useMemo(() => {
    const all = fullRange(allRows);
    const has = (day: string) => allRows.some((row) => row.day === day);
    return has(range.start) && has(range.end) ? range : all;
  }, [allRows, range]);

  const rows = useMemo(() => {
    const startIdx = allRows.findIndex((row) => row.day === clampedRange.start);
    const endIdx = allRows.findIndex((row) => row.day === clampedRange.end);
    return allRows.slice(startIdx, endIdx + 1);
  }, [allRows, clampedRange]);

  const overlay = useChartHoverOverlay({
    labels: useMemo(() => rows.map((r) => dayLabel(r.day)), [rows]),
    markers: HOVER_MARKERS,
  });

  // This chart's scene is measured through whatever transform its dialog is
  // mid-animation on, so the dialog's entrance deliberately carries no scale
  // (`skill-record.tsx`). Nothing in the type system says so; this does.
  useUntransformedHost(overlay.hostRef, "InstallChart");

  const definition = useMemo(() => {
    // A cumulative total dwarfs any single day's gain — often by two or three
    // orders of magnitude — so on one shared range the bars would be a flat
    // line along the axis. Each series therefore gets its own vertical scale,
    // measured against its own peak, which is what lets both fill the plot.
    //
    // Neither scale is ever labelled: `y` draws the grid rules and the daily
    // scale draws nothing (`axis: false`, `grid: false`). They exist purely to
    // give each series its own range, which is why two unlabelled scales are
    // honest here where two unlabelled AXES would not be.
    const totalMax = rows.reduce((max, r) => Math.max(max, r.total), 0);
    const dailyMax = rows.reduce((max, r) => Math.max(max, r.daily), 0);

    return defineChart({
      marks: [
        barY(rows, {
          id: BAR_ID,
          x: "date",
          // The true value, on its own scale. Both marks read the same row
          // objects, so the tooltip reports real numbers off whichever point
          // the group hands it.
          y: "daily",
          yScale: BAR_ID,
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
          // Painted through the edge-fade gradient, as the old chart's line was
          // (`fadeEdges` defaulted to true on its `Line`). The overlay's
          // highlight band stays solid — see the clone in `chart-hover-overlay`.
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
        // A UTC time scale, and an explicitly domained instance rather than a
        // factory: the domain IS the visible window, so the plot always spans
        // exactly the selected range.
        //
        // This was a point scale until the range control landed. Both are
        // nonband, so bars measure the same way on either ("with a nonband
        // scale, the mark estimates width from the smallest distance between
        // distinct mapped positions and uses 80 percent of that distance"), and
        // both put the first and last day on the plot edges once the domain is
        // the window. What the time scale adds is calendar-aware ticks: they
        // land on real week boundaries instead of array indices, which is what
        // lets a tick keep its identity as the window moves (see
        // `calendarTicks`). The library names exactly this as the reason to
        // upgrade off a point scale.
        //
        // The one behavioural difference: a MISSING daily snapshot is now a gap
        // rather than an invisible even step, and bar width keys off the
        // smallest gap between distinct days. Regular daily data renders
        // identically to the point scale.
        x: {
          scale: scaleUtc().domain([rows[0].date, rows[rows.length - 1].date]),
          axis: {
            line: false,
            ticks: {
              size: 0,
              padding: X_AXIS_LABEL_PADDING,
              format: (value: Date) =>
                dayLabel(value.toISOString().slice(0, 10)),
              // Anchored to the series' LAST day, which never moves, so the
              // same absolute dates keep being produced as the window changes
              // and a tick that stays visible keeps its key and travels. The
              // old point scale picked tick days by INDEX (`evenlySpaced`), so
              // every tick became a different date the moment either edge
              // moved — the churn that made dragging the range pile the dates
              // on top of each other. See `calendarTicks`.
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
        // Draws nothing itself: `axis: false` (every non-null scale renders an
        // axis by default, and a second one on the right would claim margin and
        // state a number this chart deliberately does not) and `grid: false`
        // (the y channel defaults grid on, which would cross the plot with a
        // second set of rules on top of the five above).
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
      // The overlay owns the gesture and every cursor visual; see
      // `chart-hover-overlay`. Without `focusRing: false` the chart paints its
      // own marker underneath ours — two dots, only one of them moving.
      focusRing: false,
      pointer: false,
    });
  }, [rows, allRows, touched]);

  const hostProps = chartHostProps(chartMotionEntrance);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Legend />
        {rangeable && (
          <RangeControl
            rows={allRows}
            range={clampedRange}
            // A preset is always a commit; only the brush previews.
            onRangeChange={(next) => commitRange(next)}
          />
        )}
      </div>
      <ChartHoverOverlay
        controller={overlay}
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
      {rangeable && (
        // Held off the plot so the strip reads as a separate instrument rather
        // than a second series someone forgot to label — the chart's own x
        // labels sit right above it and would otherwise appear to belong to
        // this line. Space alone does that; a rule as well was one line too
        // many in a dialog that already has the frame and the grid.
        <div className="mt-6">
          <RangeBrush
            rows={allRows}
            // The COMMITTED range, not the previewed one — feeding the live
            // drag back in here is what resets D3's anchor mid-gesture.
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

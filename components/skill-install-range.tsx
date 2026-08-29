"use client";

import { useMemo } from "react";
import { defineChart, lineY } from "@tanstack/charts";
import { brushX } from "@tanstack/charts/interaction/brush";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { scaleUtc } from "d3-scale";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/cubby-ui/toggle-group";
import { chartHostProps, INITIAL_WIDTH } from "@/components/charts/chart";
import { CHART_THEME } from "@/components/charts/chart-theme";
import { CHART_CURVE } from "@/components/charts/series-state";
import {
  dayLabelLong,
  dayWindow,
  MIN_POINTS,
} from "@/components/skill-chart-shared";

/** A day-keyed row. The chart's own row type structurally satisfies this. */
export type DayRow = { day: string };

/** Inclusive day range, the one piece of state the control and brush share. */
export type DayRange = { start: string; end: string };

/**
 * The windows offered above the chart.
 *
 * "All" rather than a number, because the series is 71 days today and grows to
 * the 90 the server returns (`INSIGHTS_HISTORY_DAYS`): a fixed "90d" would be a
 * claim that only becomes true later, where "All" is true at every length. The
 * brush strip below the plot is what keeps it from being vague — it paints the
 * full extent, so "All" is something you can see rather than take on trust.
 */
const FINITE_PRESETS = [
  { value: "7", label: "7d", days: 7, name: "Last 7 days" },
  { value: "30", label: "30d", days: 30, name: "Last 30 days" },
] as const;

const ALL_VALUE = "all";

export function fullRange(rows: readonly DayRow[]): DayRange {
  return { start: rows[0].day, end: rows[rows.length - 1].day };
}

function presetRange(rows: readonly DayRow[], days: number): DayRange {
  return fullRange(dayWindow(rows, days));
}

function sameRange(a: DayRange, b: DayRange) {
  return a.start === b.start && a.end === b.end;
}

/**
 * The presets worth offering for this series, and the range each one selects.
 *
 * A preset is dropped when it cannot narrow anything — either it would leave
 * fewer than `MIN_POINTS` samples, or it already spans the whole series, which
 * is what "All" is for. A short-history skill therefore gets no control at all
 * rather than a row of dead buttons; see the caller's early return.
 */
export function usablePresets(rows: readonly DayRow[]) {
  const all = fullRange(rows);
  return FINITE_PRESETS.map((preset) => ({
    ...preset,
    range: presetRange(rows, preset.days),
  })).filter(
    (preset) =>
      dayWindow(rows, preset.days).length >= MIN_POINTS &&
      !sameRange(preset.range, all),
  );
}

/**
 * Segmented range picker, sized to sit on the chart's legend row.
 *
 * Deliberately NOT painted in Signal Blue when selected: the chart's cumulative
 * line is already `--primary`, and DESIGN.md's One Signal Rule says two blue
 * things competing means one is wrong. The data keeps the blue; the control
 * reads as chrome around it. `ToggleGroup`'s outline variant already selects
 * with a neutral `--secondary` fill, so this is inherited rather than
 * overridden.
 *
 * No preset lights up while the range is hand-drawn on the brush — that state
 * is real and the control should show it rather than round to the nearest
 * preset.
 */
export function RangeControl({
  rows,
  range,
  onRangeChange,
}: {
  rows: readonly DayRow[];
  range: DayRange;
  onRangeChange: (next: DayRange) => void;
}) {
  const presets = usablePresets(rows);
  const all = fullRange(rows);
  const active =
    presets.find((preset) => sameRange(preset.range, range))?.value ??
    (sameRange(all, range) ? ALL_VALUE : null);

  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label="Chart range"
      // Array-valued even single-select, and an empty array while the range is
      // custom, which is what leaves every cell unpressed.
      value={active ? [active] : []}
      onValueChange={(values: string[]) => {
        const next = values[0];
        // Base UI reports the empty array when the pressed cell is pressed
        // again. Re-selecting the current range is a no-op, not a clear: there
        // is no "no range" state for the chart to render.
        if (!next) return;
        onRangeChange(
          next === ALL_VALUE
            ? all
            : (presets.find((preset) => preset.value === next)?.range ?? all),
        );
      }}
    >
      {presets.map((preset) => (
        <ToggleGroupItem
          key={preset.value}
          value={preset.value}
          aria-label={preset.name}
        >
          {preset.label}
        </ToggleGroupItem>
      ))}
      <ToggleGroupItem value={ALL_VALUE} aria-label={`All ${rows.length} days`}>
        All
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * The full-extent strip the range is drawn on: the map, where the chart above
 * it is the viewport.
 *
 * It is a SEPARATE chart host with no `ChartHoverOverlay`, and that is the
 * design rather than an implementation detail. `brushX` mounts a D3 overlay
 * that contains pointer events before normal chart focus, and the main chart's
 * overlay already owns `pointerdown`/`move`/`up` there for scrubbing (which is
 * how touch scrubbing works at all). Putting the brush on its own surface means
 * the two gestures never meet, instead of arbitrating between them at runtime.
 *
 * `keyboard: false` for the same reason on the keyboard side: `brushX` exposes
 * its two handles as real sliders once `values` is supplied, so leaving chart
 * focus on as well would put two competing tab targets on one 44px strip.
 */
export function RangeBrush({
  rows,
  range,
  onRangeChange,
}: {
  rows: readonly (DayRow & { date: Date; total: number })[];
  range: DayRange;
  onRangeChange: (next: DayRange) => void;
}) {
  // Brush candidates are the real instants, matching the strip's time scale.
  // A `Date` is a `ChartValue`, so this stays the CANDIDATE form of `brushX`
  // and keeps the keyboard sliders — the continuous form would have forced
  // `keyboard: false` and cost them.
  const dates = useMemo(() => rows.map((row) => row.date), [rows]);
  const dayOf = useMemo(() => {
    const byTime = new Map<number, string>();
    for (const row of rows) byTime.set(row.date.getTime(), row.day);
    return byTime;
  }, [rows]);

  // `total` above the series floor, exactly as the sidebar sparkline plots it
  // and for the same reason: against a zero-based domain a cumulative count
  // barely moves, so the strip drew a near-straight diagonal that told you
  // nothing about where in the history you were. Subtracting the floor spends
  // all 44px on the variation that actually exists.
  const plotted = useMemo(() => {
    const min = rows.reduce((low, row) => Math.min(low, row.total), Infinity);
    return rows.map((row) => ({ date: row.date, plot: row.total - min }));
  }, [rows]);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          lineY(plotted, {
            x: "date",
            y: "plot",
            curve: CHART_CURVE,
            // Muted, not `--primary`: the strip is an index of the data, not a
            // second reading of it, and the One Signal Rule leaves the accent
            // to the chart above.
            stroke: "var(--muted-foreground)",
            strokeOpacity: 0.55,
            strokeWidth: 1.5,
          }),
        ],
        scales: {
          // A time scale, matching the chart above. On a point scale the strip
          // spaced every day evenly while the chart spaced them by elapsed
          // time, so a missing snapshot would have slid the selection off the
          // window it names. Identical while the series is unbroken; correct
          // when it is not.
          x: {
            scale: scaleUtc().domain([
              rows[0].date,
              rows[rows.length - 1].date,
            ]),
          },
          y: { scale: scaleLinear },
        },
        controls: [
          brushX<Date>({
            range: controlledSignal(
              {
                start:
                  rows.find((row) => row.day === range.start)?.date ??
                  rows[0].date,
                end:
                  rows.find((row) => row.day === range.end)?.date ??
                  rows[rows.length - 1].date,
              },
              (next) =>
                onRangeChange({
                  start: dayOf.get(next.start.getTime()) ?? range.start,
                  end: dayOf.get(next.end.getTime()) ?? range.end,
                }),
            ),
            // The candidate form: the ordered instants the brush may snap to,
            // which is also what turns the handles into keyboard sliders.
            values: dates,
            startAriaLabel: "Range start",
            endAriaLabel: "Range end",
            format: (value: Date) =>
              dayLabelLong(value.toISOString().slice(0, 10)),
            // The SELECTION carries the accent, as a wash — a selected region
            // is one of the states DESIGN.md does assign to Signal Blue, and at
            // this opacity it cannot compete with the solid line above it.
            selectionStyle: { fill: "var(--primary)", fillOpacity: 0.14 },
            // The HANDLES stay neutral and quiet. Painted solid in the accent
            // they became the loudest thing in the dialog and, at a 7-day
            // selection on a 71-day extent, the two 24px grips met in the
            // middle and read as one blue slab rather than a range. The hit
            // rect keeps its size (this only changes paint), so the touch
            // target survives the calm.
            handleStyle: { fill: "var(--foreground)", fillOpacity: 0.28 },
          }),
        ],
        guides: false,
        margin: { top: 6, right: 14, bottom: 6, left: 14 },
        theme: CHART_THEME,
        focusRing: false,
        keyboard: false,
      }),
    [plotted, dates, dayOf, rows, range, onRangeChange],
  );

  return (
    <RendererChart
      {...chartHostProps()}
      initialWidth={INITIAL_WIDTH.dialog}
      height={44}
      ariaLabel={`Select a range within all ${rows.length} days of install history.`}
      definition={definition}
    />
  );
}

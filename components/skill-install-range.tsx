"use client";

import { useCallback, useMemo } from "react";
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
  /**
   * The COMMITTED range. Deliberately not the live one: this feeds the brush's
   * controlled value, and rewriting that mid-gesture rebuilds the definition
   * under D3 and resets the drag's own anchor. The caller keeps a separate
   * preview for what the chart above draws.
   */
  range: DayRange;
  onRangeChange: (next: DayRange, committed: boolean) => void;
}) {
  // Brush candidates are the real instants, matching the strip's time scale.
  // A `Date` is a `ChartValue`, so this stays the CANDIDATE form of `brushX`
  // and keeps the keyboard sliders — the continuous form would have forced
  // `keyboard: false` and cost them.
  const dates = useMemo(() => rows.map((row) => row.date), [rows]);
  // Nearest row to a proposed instant, never a lookup that can miss.
  //
  // An exact `Map` hit on `getTime()` was the first attempt and it froze the
  // drag: a proposal that did not land precisely on a candidate fell back to
  // the previous value, so the range stopped moving and the handles read as if
  // they had collided. Nearest always answers.
  const dayAt = useCallback(
    (at: Date) => {
      let best = rows[0];
      let bestGap = Infinity;
      for (const row of rows) {
        const gap = Math.abs(row.date.getTime() - at.getTime());
        if (gap < bestGap) {
          bestGap = gap;
          best = row;
        }
      }
      return best.day;
    },
    [rows],
  );

  // `total` above the series floor, exactly as the sidebar sparkline plots it
  // and for the same reason: against a zero-based domain a cumulative count
  // barely moves, so the strip drew a near-straight diagonal that told you
  // nothing about where in the history you were. Subtracting the floor spends
  // all 44px on the variation that actually exists.
  const plotted = useMemo(() => {
    const min = rows.reduce((low, row) => Math.min(low, row.total), Infinity);
    return rows.map((row) => ({ date: row.date, plot: row.total - min }));
  }, [rows]);

  // The selected slice, drawn a second time and brighter on top of the muted
  // full extent.
  //
  // This is how the strip says which part is selected. evilcharts dims the two
  // UNSELECTED sides instead and draws no wash at all over the selection
  // (`BRUSH_FILLER_OPACITY = 0`), which is the better idea — the selection is
  // simply the part that is not dimmed. It is not reachable here: `brushX`
  // renders a selection rect and two handles and no outside-the-selection nodes,
  // and a dim laid on the full-width overlay would darken the selection with
  // everything else. Brightening the inside is the same figure/ground read with
  // the nodes we actually have.
  const selected = useMemo(() => {
    const startIdx = rows.findIndex((row) => row.day === range.start);
    const endIdx = rows.findIndex((row) => row.day === range.end);
    if (startIdx === -1 || endIdx === -1) return plotted;
    return plotted.slice(startIdx, endIdx + 1);
  }, [rows, plotted, range]);

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
            strokeOpacity: 0.35,
            strokeWidth: 1.5,
          }),
          lineY(selected, {
            id: "selected",
            x: "date",
            y: "plot",
            curve: CHART_CURVE,
            // Neutral, not the accent: the chart above owns the blue, and this
            // is a figure/ground cue rather than a second reading of the data.
            stroke: "var(--foreground)",
            strokeOpacity: 0.8,
            strokeWidth: 1.5,
            // No motion. This mark exists to say WHICH part is selected, and a
            // highlight that eases into place says it a beat after the handle
            // has already moved — two things reporting one gesture at different
            // times. `false` snaps it, so the bright stretch is simply wherever
            // the selection is.
            motion: false,
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
              // Every phase is reported, with `committed` saying which it is.
              // The caller routes a preview to the chart above (so it tracks the
              // handle live) and a commit to this brush's own value — writing
              // previews back HERE would rebuild the definition under D3 every
              // frame and reset the gesture's anchor, which is what made
              // drawing a new range outside the selection work only sometimes
              // and stopped the handles crossing each other.
              (next, { reason }) => {
                if (reason.type === "cancel") return;
                onRangeChange(
                  { start: dayAt(next.start), end: dayAt(next.end) },
                  reason.type === "commit",
                );
              },
            ),
            // The candidate form: the ordered instants the brush may snap to,
            // which is also what turns the handles into keyboard sliders.
            values: dates,
            startAriaLabel: "Range start",
            endAriaLabel: "Range end",
            format: (value: Date) =>
              dayLabelLong(value.toISOString().slice(0, 10)),
            // A hairline FRAME around the selection, no wash inside it. The
            // wash was the accent at 14%, which put a third blue thing in a
            // dialog whose line already owns the accent, and it tinted the very
            // stretch of data it was meant to reveal. The rounding is in
            // `charts.css` — `SceneStyle` carries paint, not geometry.
            selectionStyle: {
              fill: "none",
              // The border token's own recipe at a heavier weight. `--border` is
              // `foreground 10%`, tuned to read as a hairline between surfaces;
              // at that weight a frame around the selection was invisible on the
              // strip, and the frame IS the affordance here. Still a hairline,
              // just one you can find.
              stroke: "color-mix(in oklab, var(--foreground) 22%, transparent)",
              strokeWidth: 1,
            },
            // Grip pills at the selection edges. Painted solid in the accent
            // these were the loudest thing in the dialog, and at a 7-day
            // selection on a 71-day extent the two 24px slabs met in the middle
            // and read as one block rather than a range. Paint only — the hit
            // rect keeps its size, so the touch target survives the calm, and
            // `charts.css` narrows and rounds what is actually drawn.
            handleStyle: { fill: "var(--muted-foreground)" },
          }),
        ],
        guides: false,
        margin: { top: 6, right: 14, bottom: 6, left: 14 },
        theme: CHART_THEME,
        focusRing: false,
        keyboard: false,
      }),
    [plotted, selected, dates, dayAt, rows, range, onRangeChange],
  );

  return (
    <RendererChart
      {...chartHostProps()}
      className="chart-range-brush"
      initialWidth={INITIAL_WIDTH.dialog}
      height={44}
      ariaLabel={`Select a range within all ${rows.length} days of install history.`}
      definition={definition}
    />
  );
}

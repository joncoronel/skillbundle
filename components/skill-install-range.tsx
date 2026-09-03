"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
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
  dayLabelLongAt,
  dayWindow,
  MIN_POINTS,
} from "@/components/skill-chart-shared";

/** A day-keyed row. The chart's own row type structurally satisfies this. */
export type DayRow = { day: string };

/** Inclusive day range, the one piece of state the control and brush share. */
export type DayRange = { start: string; end: string };

/**
 * Where a reported range is in its gesture. Three states, not a `committed`
 * boolean: a preview moves the plot, a commit settles the range, and a cancel
 * undoes the preview without settling anything.
 */
export type RangePhase = "preview" | "commit" | "cancel";

/** One line on the strip. It takes N of these so both charts can use it. */
export type BrushSeries = {
  key: string;
  color: string;
  values: readonly { date: Date; value: number }[];
};

/**
 * The windows offered above the chart.
 *
 * "All" rather than "90d": the series is 71 days today and only grows toward
 * the 90 the server returns (`INSIGHTS_HISTORY_DAYS`), so a number would be a
 * claim that becomes true later. The strip below paints the full extent, which
 * is what keeps "All" from being vague.
 */
const FINITE_PRESETS = [
  { value: "7", label: "7d", days: 7, name: "Last 7 days" },
  { value: "30", label: "30d", days: 30, name: "Last 30 days" },
] as const;

const ALL_VALUE = "all";

/**
 * The strip's height. 56 rather than 44 for the compare page: three series
 * share one floor there, so a skill five times another's size bunched the small
 * ones against the bottom in 44px.
 */
export const STRIP_HEIGHT = 56;

export function fullRange(rows: readonly DayRow[]): DayRange {
  return { start: rows[0].day, end: rows[rows.length - 1].day };
}

function presetRange(rows: readonly DayRow[], days: number): DayRange {
  return fullRange(dayWindow(rows, days));
}

function sameRange(a: DayRange, b: DayRange) {
  return a.start === b.start && a.end === b.end;
}

/** One offered window: the button's own text, and the range it selects. */
export type RangePreset = (typeof FINITE_PRESETS)[number] & { range: DayRange };

/**
 * The presets worth offering for this series, and the range each one selects.
 *
 * A preset is dropped when it cannot narrow anything — either it would leave
 * fewer than `MIN_POINTS` samples, or it already spans the whole series, which
 * is what "All" is for. A short-history skill therefore gets no control at all
 * rather than a row of dead buttons; see the caller's early return.
 */
export function usablePresets(rows: readonly DayRow[]): RangePreset[] {
  // The compare chart reaches here with no days whenever every compared skill
  // is too new to draw, and its "not enough history" branch renders below the
  // hooks — so this answers rather than letting `fullRange` index nothing.
  if (rows.length === 0) return [];
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
 * A range narrowed to something the chart can draw, or the full extent when it
 * cannot be placed. Two guards: a range naming days the series no longer has
 * falls back to everything, and one collapsed onto a single day would leave the
 * x scale a zero-width domain, so its start walks back to keep `MIN_POINTS`.
 */
function clampRange<T extends DayRow>(
  rows: readonly T[],
  shown: DayRange | null,
): DayRange | null {
  if (rows.length === 0) return null;
  const all = fullRange(rows);
  if (!shown) return all;
  const startIdx = rows.findIndex((row) => row.day === shown.start);
  const endIdx = rows.findIndex((row) => row.day === shown.end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return all;
  if (endIdx - startIdx + 1 >= MIN_POINTS) return shown;
  const widened = Math.max(0, endIdx - (MIN_POINTS - 1));
  // Only reachable on a series shorter than `MIN_POINTS`, which both callers
  // already gate on.
  if (endIdx - widened + 1 < MIN_POINTS) return all;
  return { start: rows[widened].day, end: shown.end };
}

/**
 * The range state machine, owned in one place because both charts run it.
 *
 * The two ranges cannot be collapsed into one, and docs/charts.md carries the
 * measurements: the brush's controlled value must hold still for a whole
 * gesture, the plot must move per frame. `commitRange` routes previews to one
 * and commits to the other.
 *
 * Both derived ranges are clamped, which keeps a blank click on the strip (a
 * zero-width commit) from reaching D3 and erasing the overlay's chrome. `range`
 * starts null so a series that grows while the view is open widens the window
 * instead of pinning a stale one.
 */
export function useDayRange<T extends DayRow>(
  rows: readonly T[],
  {
    enabled = true,
    open = "full",
  }: {
    /** False while the rows are a placeholder, which must not be brushable. */
    enabled?: boolean;
    /**
     * Where the window sits before anyone touches it. `"narrowed"` opens on the
     * widest finite preset, because the install chart's bars collapse to 5.4px
     * across a full 90 days.
     */
    open?: "full" | "narrowed";
  } = {},
) {
  const presets = useMemo(
    () => (enabled ? usablePresets(rows) : []),
    [enabled, rows],
  );
  // Nothing to narrow: no control, no strip, and the chart renders as it did
  // before the range feature existed.
  const rangeable = presets.length > 0;

  const [range, setRange] = useState<DayRange | null>(null);
  const [preview, setPreview] = useState<DayRange | null>(null);

  /**
   * Whether the reader has changed the window yet. `phase === "enter"` fires
   * for both the first paint and every mark arriving on a range change, so
   * without this the entrance replayed on every drag. State, not a ref: a ref
   * cannot be read during render.
   */
  const [touched, setTouched] = useState(false);

  const commitRange = useCallback(
    (next: DayRange, phase: RangePhase = "commit") => {
      if (phase === "preview") {
        setPreview(next);
        return;
      }
      // A cancel only drops the preview; D3 has already snapped its selection
      // back. Settling a range here would spend the untouched default and the
      // entrance on a gesture the reader abandoned.
      setPreview(null);
      if (phase === "cancel") return;
      setTouched(true);
      setRange(next);
    },
    [],
  );

  const openRange = useMemo(
    () =>
      open === "narrowed" && presets.length
        ? presets[presets.length - 1].range
        : null,
    [open, presets],
  );

  /** What the plot draws: the live drag when there is one, the settled range otherwise. */
  const windowRange = useMemo(
    () => clampRange(rows, preview ?? range ?? openRange),
    [rows, preview, range, openRange],
  );

  /** The brush's own value: clamped, and never carrying the preview. */
  const committedRange = useMemo(
    () => clampRange(rows, range ?? openRange),
    [rows, range, openRange],
  );

  const windowRows = useMemo(() => {
    if (!windowRange) return rows;
    const startIdx = rows.findIndex((row) => row.day === windowRange.start);
    const endIdx = rows.findIndex((row) => row.day === windowRange.end);
    if (startIdx === -1 || endIdx === -1) return rows;
    return rows.slice(startIdx, endIdx + 1);
  }, [rows, windowRange]);

  return {
    presets,
    rangeable,
    windowRange,
    windowRows,
    committedRange,
    /** True for the length of a pointer gesture on the strip. */
    dragging: preview !== null,
    touched,
    commitRange,
  };
}

/**
 * Segmented range picker, sized to sit on the chart's legend row.
 *
 * Not painted in Signal Blue when selected: the chart's line is already
 * `--primary`, and DESIGN.md's One Signal Rule says two competing blues mean
 * one is wrong. `ToggleGroup`'s outline variant selects with a neutral
 * `--secondary`, so that is inherited rather than overridden. A hand-drawn
 * range lights no preset; that state is real and should show.
 */
export function RangeControl({
  rows,
  presets,
  range,
  onRangeChange,
}: {
  rows: readonly DayRow[];
  /**
   * Passed in, not computed here: `usablePresets` walks the series once per
   * preset and this renders on every preview frame of a drag.
   */
  presets: readonly RangePreset[];
  /**
   * The COMMITTED range. A preview would light the 7d cell as a drag passed
   * through 7 days and drop it again a frame later.
   */
  range: DayRange;
  onRangeChange: (next: DayRange) => void;
}) {
  const all = fullRange(rows);
  const active =
    presets.find((preset) => sameRange(preset.range, range))?.value ??
    (sameRange(all, range) ? ALL_VALUE : null);

  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label="Chart range"
      // Array-valued even single-select; empty while the range is custom,
      // which is what leaves every cell unpressed.
      value={active ? [active] : []}
      onValueChange={(values: string[]) => {
        const next = values[0];
        // Base UI reports an empty array when the pressed cell is pressed
        // again. That is a no-op, not a clear: there is no "no range" state.
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
          // Leads with the visible text. "Last 7 days" over a cell reading
          // "7d" does not contain its own label (WCAG 2.5.3), and leaves voice
          // control nothing to match.
          aria-label={`${preset.label}, ${preset.name.toLowerCase()}`}
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
 * Everything you SEE on the strip: the dim outside the selection, the frame
 * around it, and a grip at each edge. `brushX` draws none of it, for two
 * reasons in docs/charts.md: D3 places its nodes at sub-pixel offsets, where a
 * 1px stroke changes weight as it moves, and it renders nothing outside the
 * selection, so the dim was unreachable through its styles.
 *
 * `pointer-events: none` throughout, so the invisible brush underneath keeps
 * every gesture.
 */
function BrushOverlay({ surface }: { surface: string }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ left: number; right: number } | null>(null);

  // Mirror D3's OWN selection rect rather than deriving a position from the
  // range. Derived, the overlay could only move a whole day at a time, because
  // the previews `brushX` reports are snapped to candidates. The rect is
  // authoritative while dragging and at rest alike.
  //
  // Client rects, which are CSS pixels: the rect's own `x` is in viewBox units.
  // Rounded, because whole-pixel edges are why this overlay exists.
  useEffect(() => {
    const shell = node?.parentElement;
    if (!shell) return;
    const update = () => {
      const sel = shell.querySelector(".selection");
      if (!sel || !node) return;
      const r = sel.getBoundingClientRect();
      const base = node.getBoundingClientRect();
      if (r.width <= 0) {
        setBox(null);
        return;
      }
      setBox({
        left: Math.round(r.left - base.left),
        right: Math.round(r.right - base.left),
      });
    };
    update();
    // `childList` catches the brush mounting its nodes after first paint; the
    // attribute filter catches every move D3 makes after that.
    const observer = new MutationObserver(update);
    observer.observe(shell, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["x", "width"],
    });
    const resize = new ResizeObserver(update);
    resize.observe(shell);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [node]);

  return (
    <div
      ref={setNode}
      aria-hidden="true"
      className="chart-brush-overlay pointer-events-none absolute inset-0"
      style={
        box
          ? ({
              "--sel-l": `${box.left}px`,
              "--sel-r": `${box.right}px`,
              "--scrim-bg": surface,
            } as CSSProperties)
          : undefined
      }
    >
      {box && (
        <>
          <div className="chart-brush-scrim" />
          <div className="chart-brush-frame" />
          {/* Two elements per grip: a mask clips everything drawn on its own
              element, focus ring included, so the inner one carries the mask
              and the outer one owns the ring. */}
          <span className="chart-brush-grip" data-edge="start">
            <span className="chart-brush-grip-pill" />
          </span>
          <span className="chart-brush-grip" data-edge="end">
            <span className="chart-brush-grip-pill" />
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The full-extent strip the range is drawn on: the map, where the chart above
 * it is the viewport.
 *
 * A SEPARATE chart host with no `ChartHoverOverlay`, by design: `brushX`
 * contains pointer events before chart focus, and the main chart's overlay
 * already owns `pointerdown`/`move`/`up` for scrubbing. Two hosts means the
 * gestures never meet instead of arbitrating at runtime. `keyboard: false` for
 * the same reason: `values` already exposes both handles as real sliders, so
 * chart focus as well would put two tab targets on one strip.
 */
export function RangeBrush({
  days,
  series,
  surface,
  range,
  onRangeChange,
}: {
  /** Every day the strip spans, in order. Sets the domain and the candidates. */
  days: readonly (DayRow & { date: Date })[];
  series: readonly BrushSeries[];
  /**
   * The colour of the surface this strip sits on, as a CSS value.
   *
   * The scrim dims by laying the container's own colour over the strip, so it
   * must be exactly that colour. A fixed token cannot serve both hosts:
   * `--background` on the skill page's Stats tab against `--card` in the
   * compare card (and `--surface-5` back when this lived in the install
   * dialog — a whole lightness step apart from `--card` in dark mode, 0.321
   * against 0.264).
   *
   * A token REFERENCE, not a resolved colour, so it follows a theme change.
   * Reading the computed colour off the DOM was tried and never re-ran.
   */
  surface: string;
  /**
   * The COMMITTED range, not the live one: this feeds the brush's controlled
   * value, and rewriting that mid-gesture resets the drag's own anchor.
   */
  range: DayRange;
  onRangeChange: (next: DayRange, phase: RangePhase) => void;
}) {
  // The real instants, matching the strip's time scale. A `Date` is a
  // `ChartValue`, so this stays the CANDIDATE form of `brushX` and keeps the
  // keyboard sliders the continuous form would have cost.
  const dates = useMemo(() => days.map((row) => row.date), [days]);

  // Nearest day to a proposed instant, never a lookup that can miss. An exact
  // `Map` hit on `getTime()` froze the drag: a miss fell back to the previous
  // value, which reads exactly like collided handles.
  const dayAt = useCallback(
    (at: Date) => {
      let best = days[0];
      let bestGap = Infinity;
      for (const row of days) {
        const gap = Math.abs(row.date.getTime() - at.getTime());
        if (gap < bestGap) {
          bestGap = gap;
          best = row;
        }
      }
      return best.day;
    },
    [days],
  );

  // Every series lifted by a SHARED floor, as the sidebar sparkline lifts its
  // own line: against a zero-based domain a cumulative count barely moves and
  // the strip draws a near-straight diagonal. One floor rather than one per
  // series, because per-series would rescale each line to fill the strip and
  // quietly claim two skills were the same size.
  const plotted = useMemo(() => {
    let min = Infinity;
    for (const line of series) {
      for (const point of line.values) min = Math.min(min, point.value);
    }
    const floor = Number.isFinite(min) ? min : 0;
    return series.map((line) => ({
      key: line.key,
      color: line.color,
      points: line.values.map((point) => ({
        date: point.date,
        plot: point.value - floor,
      })),
    }));
  }, [series]);

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          ...plotted.map((line) =>
            lineY(line.points, {
              id: line.key,
              x: "date",
              y: "plot",
              curve: CHART_CURVE,
              // The caller's colour: neutral from the install chart, whose
              // one line must not compete with the accent above; each skill's
              // own from the compare page, where three neutrals would tangle.
              stroke: line.color,
              // One strength throughout. The scrim carries the figure/ground.
              strokeOpacity: 0.7,
              strokeWidth: 1.5,
            }),
          ),
        ],
        scales: {
          // A time scale, matching the chart above. On a point scale a missing
          // snapshot would slide the selection off the window it names.
          x: {
            scale: scaleUtc().domain([
              days[0].date,
              days[days.length - 1].date,
            ]),
          },
          y: { scale: scaleLinear },
        },
        controls: [
          brushX<Date>({
            range: controlledSignal(
              {
                start:
                  days.find((row) => row.day === range.start)?.date ??
                  days[0].date,
                end:
                  days.find((row) => row.day === range.end)?.date ??
                  days[days.length - 1].date,
              },
              // Every phase reported and named. Previews go to the chart
              // above; writing them back HERE would rebuild the definition
              // under D3 every frame and reset the gesture's anchor. A cancel
              // (Escape, or a lost pointer) carries the gesture's ORIGIN, and
              // dropping it left the caller's preview standing over a window
              // D3 had already snapped away from.
              (next, { reason }) => {
                const to = reason.type === "cancel" ? reason.origin : next;
                onRangeChange(
                  { start: dayAt(to.start), end: dayAt(to.end) },
                  reason.type,
                );
              },
            ),
            // The ordered instants the brush snaps to, and what turns its
            // handles into keyboard sliders.
            values: dates,
            startAriaLabel: "Range start",
            endAriaLabel: "Range end",
            format: dayLabelLongAt,
            // INVISIBLE, and not as a style preference: `brushX` is kept for
            // interaction alone and `BrushOverlay` draws everything you see.
            // See its note above, and docs/charts.md for the measurements.
            // evilcharts hides its own slider the same way.
            selectionStyle: { fill: "none", stroke: "none" },
            handleStyle: { fill: "none" },
          }),
        ],
        guides: false,
        margin: { top: 6, right: 14, bottom: 6, left: 14 },
        theme: CHART_THEME,
        focusRing: false,
        keyboard: false,
      }),
    [plotted, dates, dayAt, days, range, onRangeChange],
  );

  return (
    <div className="chart-brush-shell relative">
      <RendererChart
        {...chartHostProps()}
        className="chart-range-brush"
        initialWidth={INITIAL_WIDTH.dialog}
        height={STRIP_HEIGHT}
        ariaLabel={`Select a range within all ${days.length} days of install history.`}
        definition={definition}
      />
      <BrushOverlay surface={surface} />
    </div>
  );
}

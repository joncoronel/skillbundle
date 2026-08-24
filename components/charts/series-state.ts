import type {
  ChartBarStateStyle,
  ChartLineStateStyle,
  ChartMarkState,
} from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { curveMonotoneX } from "d3-shape";

// Series presentation shared by every line we draw.

/**
 * Writes a mark state's value with no renderer animation, leaving the ramp to a
 * CSS transition on the same property (`globals.css`).
 *
 * The renderer re-resolves and re-animates every mark state on each focus
 * change, from whatever value the DOM currently holds. During a scrub that is
 * once per column, so a bar the cursor has already left is handed a fresh
 * 120ms tween every time and never arrives: measured mid-drag it decays 1 →
 * 0.86 → 0.63 → 0.48 → 0.45 and levels off, where the old chart's reached 0.3
 * in 123ms and stayed. A CSS transition does not restart when the value is
 * re-set to the target it is already heading for, which is the behaviour the
 * old per-bar Motion `animate` had.
 */
const NO_MOTION = { type: "tween", duration: 0 } as const;

/**
 * The soft curve these charts draw. TanStack keeps curve algorithms injected
 * rather than bundled, so this is the one D3 module we pull in directly
 * (`d3-shape`); everything else resolves through the compact scales.
 *
 * Monotone, not the old chart's `curveNatural`. Every series here is a
 * cumulative install count, and a natural spline overshoots each vertex: on a
 * one-day jump it drew the total rising 21% past the value it reached, sagging
 * back down afterwards, and dipping 18 units below the lowest figure ever
 * recorded. Measured on the old chart with that data: the totals never fall,
 * and a third of the drawn line descends. That is the chart contradicting its
 * own numbers, so it is not worth keeping for the shape. `curveMonotoneX` is
 * the same soft cubic between points but cannot overshoot one or reverse
 * direction between two of them.
 */
export const CHART_CURVE = d3Curve(curveMonotoneX);

/**
 * Fades a series while any point is focused, so the highlighted band around the
 * cursor reads as the bright part of the trace.
 *
 * Mark states are only evaluated when focus exists, so an unconditional `when`
 * means "while hovering" — the old `SeriesHoverDim`'s `tooltipData !== null`,
 * with its 0.4s tween carried over.
 */
export const HOVER_DIM: ChartMarkState<unknown, ChartLineStateStyle> = {
  when: () => true,
  style: { strokeOpacity: 0.5 },
  // Written instantly; the ramp is a CSS transition. See `BAR_UNFOCUSED_DIM`.
  transition: NO_MOTION,
};

/**
 * Fades every bar except the focused column, so the day under the cursor is the
 * one the eye lands on. Carried over from the old `SeriesBar`, down to the 0.3
 * target and the 120ms tween — bars are per-datum nodes, so this is one thing
 * the library expresses directly where the line needs the band.
 *
 * `focus: "unmatched"` is evaluated per datum against the current focus, which
 * on these charts the overlay sets through `setControlledFocus`.
 */
export const BAR_UNFOCUSED_DIM: ChartMarkState<unknown, ChartBarStateStyle> = {
  when: { focus: "unmatched" },
  style: { fillOpacity: 0.3 },
  transition: NO_MOTION,
};

import type {
  ChartBarStateStyle,
  ChartLineStateStyle,
  ChartMarkState,
} from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { curveNatural } from "d3-shape";

// Series presentation shared by every line we draw.

/**
 * The soft curve the charts have always used. TanStack keeps curve algorithms
 * injected rather than bundled, so this is the one D3 module we pull in
 * directly (`d3-shape`); everything else resolves through the compact scales.
 */
export const CHART_CURVE = d3Curve(curveNatural);

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
  transition: { type: "tween", duration: 400, easing: "ease-out" },
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
  transition: { type: "tween", duration: 120, easing: "ease-out" },
};

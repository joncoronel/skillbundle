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
 * CSS transition on the same property (`charts.css`).
 *
 * The renderer restarts every mark state on each focus change, so during a
 * scrub a fade is retargeted once per column and never arrives. A CSS
 * transition ignores a write that does not move the target. See docs/charts.md.
 */
const NO_MOTION = { type: "tween", duration: 0 } as const;

/**
 * The soft curve these charts draw. TanStack keeps curve algorithms injected
 * rather than bundled, so this is the one D3 module we pull in directly
 * (`d3-shape`); everything else resolves through the compact scales.
 *
 * Monotone, not the old chart's `curveNatural`: every series here is a
 * cumulative count, and a natural spline overshoots each vertex, drawing a
 * line that contradicts its own numbers. See docs/charts.md.
 */
export const CHART_CURVE = d3Curve(curveMonotoneX);

/**
 * Fades a series while any point is focused, so the highlighted band around the
 * cursor reads as the bright part of the trace.
 *
 * Mark states are only evaluated when focus exists, so an unconditional `when`
 * means "while hovering".
 */
export const HOVER_DIM: ChartMarkState<unknown, ChartLineStateStyle> = {
  when: () => true,
  // 0.3, matching the bars. The old `SeriesHoverDim` defaulted to 0.5, but its
  // `Line` call site passed `dimOpacity={0.3}` and the default is what got
  // copied here first.
  style: { strokeOpacity: 0.3 },
  transition: NO_MOTION,
};

/**
 * Fades every bar except the focused column. Bars are per-datum scene nodes, so
 * `focus: "unmatched"` resolves per datum and the library expresses this
 * directly, where the line needs the overlay's cloned band instead.
 */
export const BAR_UNFOCUSED_DIM: ChartMarkState<unknown, ChartBarStateStyle> = {
  when: { focus: "unmatched" },
  style: { fillOpacity: 0.3 },
  transition: NO_MOTION,
};

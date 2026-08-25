import { tooltip } from "@tanstack/charts/tooltip";

/**
 * Distance the panel is held off the focused point.
 *
 * Carried over from the old chart's `TooltipBox`, which sat one offset to the
 * side of the cursor and flipped rather than sliding.
 */
export const TOOLTIP_OFFSET = 16;

/**
 * The library's tooltip, placed beside the focused point.
 *
 * Deliberately NOT portalled: unportalled its collision bounds are the chart,
 * so it flips sides rather than leaving the container. Portalled it is placed
 * against the viewport, which has room the chart does not — on the install
 * dialog it hangs up to 217px past the chart, floating over the backdrop.
 *
 * The unportalled path positions from scene coordinates and writes CSS pixels,
 * so it needs those units to agree. See `useSettledBox`.
 */
export const CHART_TOOLTIP = {
  use: tooltip,
  anchor: "point",
  placement: ["right", "left"],
  offset: TOOLTIP_OFFSET,
} as const;

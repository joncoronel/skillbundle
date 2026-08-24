import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";

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
 * `portal` is what keeps it off the marker: without it the panel's collision
 * bounds are the chart, and at mid-plot it resolves onto the very point it is
 * describing (measured). Portalled, it is positioned in the browser's top layer
 * against the viewport instead, so it clears the marker at every column — at
 * the cost of hanging outside the chart's container near the right-hand edge,
 * since the viewport has room the chart does not. There is no collision-bounds
 * option between those two behaviours.
 */
export const CHART_TOOLTIP = {
  use: tooltip,
  portal,
  anchor: "point",
  placement: ["right", "left"],
  offset: TOOLTIP_OFFSET,
} as const;

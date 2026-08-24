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
 * Deliberately NOT portalled. The two available behaviours are the whole of the
 * choice — the option surface has no collision-bounds setting between them:
 *
 * - Unportalled (this), the panel's collision bounds are the chart. It never
 *   leaves the container, but as the focus crosses the middle the offset is
 *   squeezed against the right edge — measured 15px, 10px, 4px, then 0 at
 *   mid-plot, where the marker sits against the panel's edge — until it flips
 *   to the left side around 70% and recovers a 39px gap.
 * - Portalled, it is positioned in the top layer against the viewport, so the
 *   offset is exactly 16px at every column. The cost is that the viewport has
 *   room the chart does not: on the install dialog it hangs up to 217px past
 *   the chart for the rightmost third, detaching from the dialog and floating
 *   over the backdrop.
 *
 * A gap that narrows for part of the sweep is a smaller flaw than a panel that
 * leaves its dialog, so the squeeze wins. Note it depends on panel width
 * against chart width: longer content widens the band where the gap is gone.
 */
export const CHART_TOOLTIP = {
  use: tooltip,
  anchor: "point",
  placement: ["right", "left"],
  offset: TOOLTIP_OFFSET,
} as const;

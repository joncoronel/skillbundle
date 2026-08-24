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
 * Deliberately NOT portalled. Unportalled, the panel's collision bounds are the
 * chart, so it flips sides rather than leaving the container, and the offset
 * holds at 16px the whole way across. Portalled, it is positioned in the top
 * layer against the viewport instead, which has room the chart does not: on the
 * install dialog it hangs up to 217px past the chart for the rightmost third,
 * detaching from the dialog and floating over the backdrop.
 *
 * This used to look like a trade rather than a choice, because unportalled the
 * gap decayed across the plot — 15px, 10px, 4px, then flush against the marker
 * at mid-plot, recovering ~40px once it flipped. That was not the placement
 * logic, which is symmetric. The unportalled path positions the panel from
 * scene coordinates and writes them as CSS pixels, so it drifts wherever the
 * two disagree, and in the dialog they disagreed by 5%. See `useSettledBox`
 * for why, and note the portalled path converts (`sceneToClient`), which is why
 * only this one was affected.
 */
export const CHART_TOOLTIP = {
  use: tooltip,
  anchor: "point",
  placement: ["right", "left"],
  offset: TOOLTIP_OFFSET,
} as const;

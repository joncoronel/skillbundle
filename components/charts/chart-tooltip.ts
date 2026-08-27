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
 * Only the unportalled path is exposed to a scene unit that is not a CSS
 * pixel: it writes scene coordinates straight into `left`, where the portalled
 * path converts first. The two coincide only while the chart's scene width
 * equals its painted width, which is why nothing may mount a chart inside a
 * scaling ancestor — docs/charts.md, under measurement.
 */
export const CHART_TOOLTIP = {
  use: tooltip,
  anchor: "point",
  placement: ["right", "left"],
  offset: TOOLTIP_OFFSET,
} as const;

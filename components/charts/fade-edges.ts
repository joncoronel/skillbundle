import type { ChartLinearGradient } from "@tanstack/charts";

// Softens where a line meets the left and right edges of the plot, so a trace
// that runs off the axis reads as continuing rather than being cut.
//
// The old chart faded with an opacity mask, which was colour-agnostic and could
// be shared by every series. TanStack declares gradients as chart resources
// referenced by paint, so a gradient carries its own colour and each series
// needs its own — hence the id-per-series below.
//
// Stops are the historic 0/15/85/100 pattern. Gradient coordinates are the
// path's bounding box (SVG's `objectBoundingBox` default, which the renderer
// does not override): fine here because every compared line spans the full day
// range, so its box and the plot agree horizontally.

export function fadeEdgesGradient(
  id: string,
  color: string,
): ChartLinearGradient {
  return {
    id,
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    stops: [
      { offset: 0, color, opacity: 0 },
      { offset: 0.15, color, opacity: 1 },
      { offset: 0.85, color, opacity: 1 },
      { offset: 1, color, opacity: 0 },
    ],
  };
}

/** Stable gradient id for a series key, shared by the resource and its paint. */
export function fadeEdgesId(seriesKey: string) {
  return `fade-${seriesKey}`;
}

import { crosshair } from "@tanstack/charts";
import { DISCRETE_THRESHOLD } from "./chart-hover-overlay";
import { FOCUS_SPRING } from "./chart-motion";

/**
 * The vertical rule marking the focused column, following the focus the overlay
 * sets through `setControlledFocus`.
 *
 * Place it LAST in `marks`: mark order is paint order, so earlier hides it
 * behind the bars.
 *
 * Neutral rather than the series colour, so it does not compete with the line
 * carrying the data, and one step stronger than the grid's `--border` so it
 * does not read as another gridline.
 */
export function focusCrosshair(pointCount: number) {
  return crosshair({
    x: {
      stroke: "var(--muted-foreground)",
      strokeOpacity: 0.5,
      strokeDasharray: "4 4",
    },
    y: false,
    // The guide runs on the renderer's motion, not the overlay's, so it takes
    // the same spring or it drifts from the marker it shares an x with (~4px
    // mid-travel), and it has to be gated at the density threshold separately.
    motion: {
      transition:
        pointCount > DISCRETE_THRESHOLD
          ? { type: "tween", duration: 0 }
          : FOCUS_SPRING,
    },
  });
}

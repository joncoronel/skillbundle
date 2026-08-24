import { crosshair } from "@tanstack/charts";
import { DISCRETE_THRESHOLD } from "./chart-hover-overlay";
import { FOCUS_SPRING } from "./chart-motion";

/**
 * The vertical rule marking the focused column.
 *
 * This one IS the library's — `crosshair` follows the focus the overlay sets
 * through `setControlledFocus`, and the motion renderer springs it. The rest of
 * the cursor (markers, highlight band, date pill, tooltip) stays ours, because
 * none of it is expressible as a guide: the band re-strokes the line through a
 * moving window, the pill is a two-track ticker that overhangs the plot, and a
 * guide's own label is clamped inside it.
 *
 * Place it LAST in `marks`. Mark order is paint order, so earlier puts the rule
 * behind the bars, where a bar hides it.
 *
 * Neutral rather than the series colour: the rule says which column is being
 * read, and in the accent it competes with the line carrying the data. One step
 * stronger than the grid's `--border` so it does not read as another gridline.
 */
export function focusCrosshair(pointCount: number) {
  return crosshair({
    x: {
      stroke: "var(--muted-foreground)",
      strokeOpacity: 0.5,
      strokeDasharray: "4 4",
    },
    y: false,
    // The guide runs on the renderer's motion, not the overlay's, so it needs
    // the same spring or it drifts from the marker it shares an x with —
    // measured ~4px apart mid-travel on the renderer's default. Above the
    // density gate the cursor stills, and the guide has to be told separately
    // for the same reason: it is not driven by the overlay's MotionValues.
    motion: {
      transition:
        pointCount > DISCRETE_THRESHOLD
          ? { type: "tween", duration: 0 }
          : FOCUS_SPRING,
    },
  });
}

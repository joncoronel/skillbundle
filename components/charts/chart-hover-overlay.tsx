"use client";

import { cn } from "@/lib/utils";
import { Cursor } from "./chart-cursor";
import { DatePill } from "./chart-date-pill";
import type { ChartHoverOverlayController } from "./use-chart-hover-overlay";

// The dots, the highlight band and the date pill — drawn over the chart and
// driven by Motion. The rule is NOT here: it is the library's `crosshair` mark
// (`focus-crosshair.ts`), and the tooltip panel is the library's too.
//
// What is left is what a focus guide cannot express. The band re-strokes the
// line through a moving window, cloned from the painted path so it cannot
// drift off the trace. The pill is a two-track ticker that stays centred on
// its column and overhangs the plot at both ends, where a guide's own label is
// clamped inside. The dots carry a per-series marker with a halo in the page
// tone.
//
// This file once claimed the library's guides wedge under a fast pointer, and
// gave that as the reason for hand-rolling all of it. That was measured and is
// false: 80 distinct positions in 90 frames against our own rule's 89. The
// freeze was self-inflicted, by calling `setControlledFocus` on every pointer
// move and cancelling the in-flight animation each time.
//
// Nothing here re-renders while the pointer moves. Focus updates land on
// MotionValues, which Motion writes straight to the DOM — important, because a
// React commit re-pushes props to the chart host and cancels its motion
// mid-flight (see AGENTS.md).

// Re-exported so a chart needs one import for the whole overlay.
export {
  DISCRETE_THRESHOLD,
  pointForMarker,
  useChartHoverOverlay,
  type ChartHoverOverlayController,
  type HoverMarker,
} from "./use-chart-hover-overlay";

export function ChartHoverOverlay({
  controller,
  children,
  showPill = true,
  pillOffset = 0,
  dotScale = 1,
  surface = "var(--background)",
}: {
  controller: ChartHoverOverlayController;
  children: React.ReactNode;
  showPill?: boolean;
  /** Distance from the wrapper's bottom edge to the pill, in px. */
  pillOffset?: number;
  /** Shrinks the marker for short charts, where full size crowds the plot. */
  dotScale?: number;
  /**
   * What the markers punch through.
   *
   * The page tone, not the tier the chart happens to sit on — the old chart's
   * `--chart-background`, which was white in light and near-black in dark
   * whatever was behind it. Handing it the dialog's own surface instead makes
   * the ring vanish into it in dark, where the tiers actually differ; the halo
   * is meant to hold the dot off the line, so it has to contrast with both.
   */
  surface?: string;
}) {
  return (
    // `touch-action: pan-y` hands horizontal drags to us while leaving vertical
    // scrolling to the browser: without it the page claims the gesture and
    // cancels the pointer part-way through a scrub. The old chart used `none`,
    // which also blocked scrolling over the chart — a worse trade on a phone,
    // where the sparkline sits in the middle of a long page.
    <div
      className={cn("relative touch-pan-y", controller.tickScope)}
      ref={controller.hostRef}
      {...controller.pointerProps}
    >
      {/* One rule per date label, generated when the chart renders. Empty on a
          chart with no axis (the sparkline). */}
      <style ref={controller.tickStyleRef} />
      {children}
      <Cursor controller={controller} dotScale={dotScale} surface={surface} />
      {/* The pill hangs past this box at the first and last column, so nothing
          here may clip: it spills into the padding of whatever the chart sits
          in, exactly as the old chart's did. What stops that from widening the
          page is the dialog and the card, both of which clip their own
          overflow — verified at phone width on both, since an overhanging
          absolute child otherwise widens the nearest scroll container and
          flicks a horizontal scrollbar mid-drag. */}
      {showPill && (
        <div className="pointer-events-none absolute inset-0">
          <DatePill controller={controller} pillOffset={pillOffset} />
        </div>
      )}
    </div>
  );
}

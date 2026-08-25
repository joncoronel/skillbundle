"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  motion,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  DISCRETE_THRESHOLD,
  splitLabels,
  TICKER_ITEM_HEIGHT,
  type ChartHoverOverlayController,
} from "./use-chart-hover-overlay";

/**
 * The date under the cursor. Month and day scroll independently, so moving
 * across a month boundary rolls the month once while the day keeps ticking.
 */
export function DatePill({
  controller,
  pillOffset,
}: {
  controller: ChartHoverOverlayController;
  pillOffset: number;
}) {
  const { days } = useMemo(
    () => splitLabels(controller.labels),
    [controller.labels],
  );
  const compact = controller.labels.length > DISCRETE_THRESHOLD;

  // The pill stays centred on its column the whole way across, including the
  // first and last, which means it hangs past the plot at both ends — as the
  // old chart's did. Clamping it inside instead is worse than the overhang: it
  // decouples the pill from the mark it is labelling exactly where the mark is
  // easiest to point at.
  //
  // Its width is still measured, for the label fade (`paintTickFade`) and for
  // the tooltip. By observer rather than read in a transform: transforms run
  // per frame, and `offsetWidth` there would force a layout on each one.
  const pillRef = useRef<HTMLDivElement | null>(null);
  const pillHalf = controller.pillHalf;
  useEffect(() => {
    const el = pillRef.current;
    if (!el) {
      return;
    }
    const measure = () => pillHalf.set(el.offsetWidth / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pillHalf]);

  // The offset is expressed in the same scene units as the axis margins it is
  // derived from, so it scales with them.
  const bottom = useTransform(
    controller.pxPerUnit,
    (scale) => pillOffset * scale,
  );

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 -translate-x-1/2"
      style={{ left: controller.pillX, bottom, opacity: controller.opacity }}
    >
      {/* The pill is opaque and sits on the tick-label row, so it hides the
          label it is standing on. Its neighbours are further apart than it is
          wide (see `AXIS_TICK_LABELS.thin`), so there is nothing to fade: the
          label under the cursor is covered whole, and the next one along is
          clear of the pill entirely.

          It used to sit on a feathered strip of the chart's surface, to stand
          in for the old chart's fading of the labels themselves — which is not
          reproducible here, since the chart strips inline styles off its own
          nodes on every repaint. The strip read as a bar of blank surface
          sweeping the axis, worst on a phone where it spanned much of the
          width. Overlapping nothing is better than covering it up. */}
      {/* The panel's surface, so the two read as one instrument. The old chart
          inverted the pill instead (`bg-zinc-900` / `dark:bg-zinc-100`), which
          left it near-white in dark against a near-black panel.

          It keeps a shadow where the panel has none, because unlike the panel
          this one sits ON the plot. `sm` rather than the old pill's `lg`: the
          pill is aligned to the tick-label row, ~3px off the bottom of the
          chart box, and the dialog's scrollable body ends ~7px below that.
          `shadow-lg` reaches about 22px and was cut off square there — on the
          old chart too. `sm` reaches ~4px and fits. */}
      <div
        className="overflow-hidden rounded-full bg-chrome px-4 py-1 text-foreground shadow-sm"
        data-surface="chrome"
        ref={pillRef}
      >
        {compact ? (
          <CompactLabel dayY={controller.dayY} labels={controller.labels} />
        ) : (
          <div className="flex h-6 items-center justify-center gap-1">
            <Track
              items={controller.monthSegments.map((s) => s.month)}
              y={controller.monthY}
            />
            <Track items={days} y={controller.dayY} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Track({
  items,
  y,
}: {
  items: readonly string[];
  y: MotionValue<number>;
}) {
  return (
    <div className="relative h-6 overflow-hidden">
      <motion.div className="flex flex-col" style={{ y }}>
        {items.map((item, i) => (
          <div
            className="flex h-6 shrink-0 items-center justify-center"
            key={`${item}-${i}`}
          >
            <span className="text-sm font-medium whitespace-nowrap">
              {item}
            </span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Long series skip the scroll: a stack of hundreds of days is a lot of DOM to
 * animate for a label that would blur past anyway.
 */
function CompactLabel({
  dayY,
  labels,
}: {
  dayY: MotionValue<number>;
  labels: readonly string[];
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  const paint = useCallback(
    (value: number) => {
      const label = labels[Math.round(-value / TICKER_ITEM_HEIGHT)];
      if (ref.current && label) {
        ref.current.textContent = label;
      }
    },
    [labels],
  );

  useMotionValueEvent(dayY, "change", paint);

  // The change event is not enough on its own. A MotionValue only notifies when
  // the value actually changes, and `dayY` starts at 0 — which is also what the
  // leftmost column writes. Starting a scrub there fired nothing and left the
  // pill blank until the pointer reached another column. Painting the current
  // value on mount covers that, and re-running when `labels` arrives covers a
  // series whose data lands after the first render.
  useEffect(() => {
    paint(dayY.get());
  }, [paint, dayY]);

  return (
    <span
      className="flex h-6 items-center text-sm font-medium whitespace-nowrap"
      ref={ref}
    />
  );
}

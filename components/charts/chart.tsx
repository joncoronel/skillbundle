"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { chartMotion, chartMotionEntrance } from "./chart-motion";
import { CHART_HOST_VARS } from "./chart-theme";
// The library's own nodes, styled where our utilities cannot reach. Imported
// here because every chart imports this module.
import "./charts.css";

// Shared host wiring for every chart, spread into `RendererChart` rather than
// wrapped around it.
//
// A generic wrapper component would have to re-declare the datum and axis type
// parameters, and every one of them would collapse to `unknown` at the call
// site — losing the typed `point.datum` in `renderTooltipBody` and
// `onFocusChange` that is most of the reason to use this library. Spreading
// props keeps each chart's inference intact.
//
// `RendererChart` from `@tanstack/charts/react/tooltip` is the entry that
// accepts both a `renderer` and `renderTooltipBody`; the plain `/react` `Chart`
// accepts neither.

/**
 * Host props every chart spreads.
 *
 * Motion runs everywhere, touch included — the old chart eased the panel along
 * with the finger and that travel is part of how it reads. It used to be
 * disabled on small screens to stop the tooltip's travel escaping the chart and
 * flicking a scrollbar; the panel is now capped narrow enough that its resolved
 * position always fits (the `maxWidth` in `chart-tooltip-panel.tsx`), so the
 * travel between two fitting positions cannot escape either.
 */
export function chartHostProps(renderer: typeof chartMotion = chartMotion) {
  return {
    // `chartMotionEntrance` for the library's own first paint; only the install
    // chart passes it.
    //
    // Typed `typeof chartMotion`, NOT `ChartRenderer`: the latter is generic, so
    // annotating with it bare pins the datum to `unknown` and collapses
    // `point.datum` at every call site — the same trap the note above describes.
    renderer,
    style: CHART_HOST_VARS as CSSProperties,
  };
}

/**
 * Width each chart is laid out at, passed as `initialWidth`.
 *
 * The adapter renders its first markup at this width and only measures the real
 * container after commit. Everything sized in scene units — stroke widths,
 * marker radii, the fixed pixel margins — is then scaled by the ratio between
 * the two, so a chart that is really 240px wide but first drawn at the 640px
 * default paints a hairline and redraws visibly thicker a frame later. Matching
 * the real width removes that; being wrong only costs the same reflow the
 * default already causes.
 */
export const INITIAL_WIDTH = {
  /** Skill page sidebar column. */
  sparkline: 240,
  /** `sm:max-w-2xl` dialog (42rem), less `DialogBody`'s 1.5rem each side. */
  dialog: 624,
  /** Compare page card at the common desktop width. */
  compare: 1160,
} as const;

/**
 * The compare chart's left-to-right entrance over the marks group, and only its
 * own. It is the one chart that travels along x: a `clip-path` needs no
 * per-datum handle, where the renderer has none for a line, so
 * `chartMotionEntrance` can only grow it from the y baseline (measured, and
 * reverted). The install chart takes the renderer's, since bars ARE per-datum.
 *
 * Apply it to the commit that puts REAL data on screen, not to the mount — on
 * the compare chart the mount belongs to the placeholder.
 */
export const CHART_REVEAL_CLASS = "chart-reveal";

/**
 * Whether the element has a width a chart can be laid out from yet. Hold a
 * chart's render on this wherever it can mount into a box that is not laid out.
 *
 * `currentWidth()` treats a zero measurement as "cannot measure" and falls back
 * to the constant `initialWidth`, which is wrong at most viewport sizes.
 * Measured on the compare page, where the chart mounts as Suspense reveals its
 * subtree: the container is 0 for one frame, so the scene was built at 1160 and
 * painted 4% oversized in a 1207px box for ~130ms, cold and warm alike.
 *
 * Costs one frame of an empty box, so the caller reserves the height. An
 * observer rather than a polling loop, so there is no deadline to pick.
 *
 * Returns a CALLBACK ref: a ref object never notifies, so a caller that renders
 * another branch first (the "no history yet" return) leaves it null and nothing
 * re-runs when the box finally mounts — the chart never renders at all.
 */
export function useMeasuredHost() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    if (!node || measured) return;
    if (node.clientWidth > 0) {
      setMeasured(true);
      return;
    }
    const observer = new ResizeObserver(() => {
      if (node.clientWidth > 0) setMeasured(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, measured]);

  return [setNode, measured] as const;
}

/**
 * Dev-only tripwire: warns if a chart is mounted inside a scaling ancestor.
 *
 * The library measures with `getBoundingClientRect`, which carries an ancestor
 * transform, and a transform fires no ResizeObserver — so the chart lays its
 * scene out at the wrong size and never finds out. At `scale-95` every stroke
 * width, tick font and marker radius comes out 5.3% oversized.
 *
 * A warning rather than a repair on purpose: the fix is to drop the scale at
 * the mount site, as the install dialog did (`skill-record.tsx`). Correcting it
 * here means re-laying out, which is itself a visible snap.
 *
 * Compiles away in production. `clientWidth` is the reference because it is the
 * one width a transform cannot reach.
 */
export function useUntransformedHost(
  ref: RefObject<HTMLElement | null>,
  name: string,
) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const element = ref.current;
    if (!element) return;
    // One frame, so a starting entrance has begun to move: a transform reads as
    // 1 on the commit it is applied.
    const frame = requestAnimationFrame(() => {
      const painted = element.getBoundingClientRect().width;
      const layout = element.clientWidth;
      if (layout === 0 || Math.abs(painted - layout) < 0.5) return;
      console.warn(
        `[charts] "${name}" is mounted inside a scaling ancestor: painted ` +
          `${painted.toFixed(1)}px against a ${layout}px layout box. The ` +
          `chart has laid its scene out at the painted width and will not ` +
          `re-measure, so it paints ${((layout / painted - 1) * 100).toFixed(1)}% off. ` +
          `Remove the scale from the ancestor's transition — see docs/charts.md.`,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, name]);
}

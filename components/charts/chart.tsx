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
    // Pass `chartMotionEntrance` for the library's own first paint. Only the
    // install chart does; see that constant for what it needs from the surface
    // it mounts in.
    //
    // Typed `typeof chartMotion`, NOT `ChartRenderer`. The latter is generic and
    // annotating with it bare pins the datum to `unknown`, which collapses
    // `point.datum` at every call site: the same trap the note above describes
    // for a wrapper component. `motion()` returns a universal renderer that
    // still infers per chart.
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
 * Plays the left-to-right entrance over the marks group.
 *
 * The compare chart's entrance, and only its own. It is the only one that
 * travels along x: a `clip-path` needs no per-datum handle, where the renderer
 * has none for a line — its marks are one scene node, so `chartMotionEntrance`
 * can only grow them from the y baseline (measured, and reverted). The install
 * chart takes the renderer's instead, because bars ARE per-datum nodes and it
 * staggers them.
 * The sidebar sparkline has no entrance, matching the `animationDuration={0}`
 * it always passed.
 *
 * Apply it to whatever commit puts REAL data on screen, not to the mount. On
 * the compare chart that is when `loading` ends, since the mount belongs to the
 * placeholder — a class change is a prop change, so the host re-renders and the
 * animation starts on a node already sitting there. A chart that opens with its
 * data in hand wipes at mount under the same rule.
 */
export const CHART_REVEAL_CLASS = "chart-reveal";

/**
 * Whether `ref`'s element has a width a chart can be laid out from yet.
 *
 * Hold a chart's render on this whenever it can mount into a box that is not
 * laid out. `currentWidth()` treats a zero measurement as "cannot measure" and
 * falls back to `initialWidth`, which is a constant and therefore wrong at most
 * viewport sizes; the container's real width then arrives on a ResizeObserver
 * pass rather than in the same frame. Measured on the compare page, where the
 * chart mounts as the Suspense boundary reveals its subtree: the container is
 * 0 for one frame, so the scene was built at `INITIAL_WIDTH.compare` (1160) and
 * painted 4% oversized inside a 1207px box for ~130ms before snapping — cold
 * and warm alike, so not a dev-compile artifact.
 *
 * Costs one frame of an empty box, which is why the caller reserves the height.
 * That is a different thing from the swap this replaced: it is one commit, not
 * a wait on data.
 *
 * An observer rather than a polling loop, so there is no deadline to pick and
 * nothing spinning if the box stays hidden.
 *
 * Returns a CALLBACK ref, not a `RefObject`. A ref object never notifies, so a
 * caller that renders another branch first (the compare chart's "no history
 * yet" return) leaves it null, the effect bails, and nothing re-runs when the
 * box finally mounts: the chart then never renders at all.
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
 * The library measures its container with `getBoundingClientRect`, which
 * carries an ancestor transform, and a transform fires no ResizeObserver — so
 * a chart mounted under one lays its scene out at the wrong size and never
 * finds out. The whole scene then paints at that ratio: at `scale-95`, every
 * stroke width, tick font and marker radius comes out 5.3% oversized.
 *
 * There used to be a `useSettledBox` hook that polled for this and rebuilt the
 * definition to correct it. It worked, but the correction is itself a visible
 * snap, so it also had to hold the chart's paint behind a fade. The install
 * dialog dropped the scale from its transition instead (`skill-record.tsx`),
 * which removes the cause rather than the symptom — and this is what keeps
 * that from silently regressing. It is a warning rather than a repair on
 * purpose: the failure is a design mistake at the mount site, and the fix
 * belongs there.
 *
 * Compiles away in production. `clientWidth` is the reference because it is
 * the one width a transform cannot reach.
 */
export function useUntransformedHost(
  ref: RefObject<HTMLElement | null>,
  name: string,
) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const element = ref.current;
    if (!element) return;
    // One frame, so an entrance that is only starting has begun to move: a
    // transform mid-transition reads as 1 on the commit it is applied.
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

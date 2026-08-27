"use client";

import { useEffect, type CSSProperties, type RefObject } from "react";
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
export function useChartHostProps(options?: { entrance?: boolean }) {
  return {
    // `entrance` opts into the library's own first paint. Only the install
    // chart takes it; see `chartMotionEntrance` for what it needs from the
    // surface it mounts in.
    renderer: options?.entrance ? chartMotionEntrance : chartMotion,
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
 * The compare chart's entrance, and only its own: a `clip-path` animation is
 * immune to what the renderer commits, which is what makes it the right choice
 * on a page that can relayout under it. The install chart wants the same
 * left-to-right reading but gets it from the renderer instead
 * (`chartMotionEntrance`), which grows the marks rather than uncovering them.
 * The sidebar sparkline has no entrance, matching the `animationDuration={0}`
 * it always passed.
 */
export const CHART_REVEAL_CLASS = "chart-reveal";

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

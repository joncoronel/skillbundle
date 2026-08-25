"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { chartMotion } from "./chart-motion";
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
export function useChartHostProps() {
  return {
    renderer: chartMotion,
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
  /** `sm:max-w-2xl` dialog, less its padding. */
  dialog: 592,
  /** Compare page card at the common desktop width. */
  compare: 1160,
} as const;

/**
 * Plays the left-to-right entrance over the marks group. Two of our three
 * charts opt out, matching the `animationDuration={0}` they have always passed.
 */
export const CHART_REVEAL_CLASS = "chart-reveal";

/**
 * How long `useSettledBox` waits for a box to stop moving, in ms.
 *
 * Generous against the 200ms the dialog takes, because overshooting costs
 * nothing: the loop exits on the frame the box matches, so this only bounds the
 * case where it never will.
 */
const SETTLE_TIMEOUT = 1000;

/**
 * A token that changes once the element's painted box matches its layout box.
 *
 * Fold it into a chart's `defineChart` memo to force one re-layout after an
 * ancestor's entrance transform has finished:
 *
 * ```ts
 * const definition = useMemo(() => defineChart({ ... }), [rows, settled]);
 * ```
 *
 * The chart measures its container with `getBoundingClientRect`, which is
 * screen space and so carries any transform an ancestor is mid-animation on.
 * The install dialog opens with `scale-95`, so a chart mounted inside it
 * measures 95% of the real width — 592.8 against a 624px container — and then
 * keeps that number, because the only thing that would make it re-measure is
 * its ResizeObserver, and a transform changes no layout box for one to see.
 *
 * Everything downstream then works in a scene unit worth 1.0526 CSS px. Our
 * overlay converts and survives it, but the library positions its own tooltip
 * from scene coordinates without converting, so the panel drifted left by up
 * to 31px across the plot: flush against the marker on the right, and a ~45px
 * gap once it flipped to the left.
 *
 * Re-rendering is what forces the re-measure — the adapter re-lays-out when a
 * size or definition prop changes, not on every commit — and the rebuilt
 * definition is identical, so nothing else moves.
 *
 * `clientWidth` is the layout box and ignores transforms, which is what makes
 * it the reference to compare against. Handing the chart a measured `width`
 * instead was tried and is worse: `width` means the application owns fixed
 * geometry, so the host is pinned in pixels (`width: 1207px`), and inside a
 * grid item at its default `min-width: auto` that pins the track the chart is
 * measuring — the compare chart then could not shrink on resize.
 */
export function useSettledBox(ref: React.RefObject<HTMLElement | null>) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    let frame = 0;
    const deadline = performance.now() + SETTLE_TIMEOUT;
    const check = () => {
      // Sub-pixel, because a fractional container width lands the two a
      // rounding apart even with no transform in play.
      const matches =
        Math.abs(element.getBoundingClientRect().width - element.clientWidth) <
        0.5;
      // The deadline is not a safety net, it is the exit for a transform that
      // never goes away: cubby-ui's dialog carries
      // `scale-[calc(1-0.1*var(--nested-dialogs))]`, so opening a dialog on top
      // of this one leaves it scaled to 0.9 for as long as it is stacked.
      // Without this the loop would poll at 60fps for the life of the dialog.
      // Giving up still re-measures, which is the best available answer — a
      // chart under a standing transform cannot measure itself correctly, and
      // one wasted re-layout is cheaper than the poll.
      if (matches || performance.now() > deadline) {
        setSettled(true);
        return;
      }
      frame = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(frame);
  }, [ref]);

  return settled;
}

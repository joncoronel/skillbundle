"use client";

import type { CSSProperties } from "react";
import { chartMotion } from "./chart-motion";
import { CHART_HOST_VARS } from "./chart-theme";

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
 * position always fits (see `TOOLTIP_MAX_WIDTH_NARROW`), so the travel between
 * two fitting positions cannot escape either.
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

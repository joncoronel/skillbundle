"use client";

import { useEffect, useState } from "react";
import { motion } from "@tanstack/charts/motion";

// Every animated thing in these charts except the entrance wipe: the crosshair
// rule, the focus dot, the date label, the highlight band, and the tooltip
// panel's travel between points. TanStack's motion renderer drives all of them
// off one spring, which is why the old per-surface springs collapse into the
// two constants below.
//
// The numbers are carried over from the bklit chart config so the feel does not
// change: `tooltipSpring` (crosshair / dot / date pill) becomes the renderer
// fallback, and `highlightSpring` stays with the highlight band because it was
// deliberately looser than the dot it trails.

export const FOCUS_SPRING = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 1,
} as const;

export const HIGHLIGHT_SPRING = {
  type: "spring",
  stiffness: 180,
  damping: 28,
  mass: 1,
} as const;

/**
 * Shared across every chart on the page — the renderer is stateless with
 * respect to any one chart, and building it once keeps the spring solver out of
 * each definition's memo.
 *
 * `initial: false` hands the entrance to CSS. TanStack's own first paint grows
 * paths up from the y baseline; ours wipes left to right over the marks group
 * only (see `.chart-reveal` in `charts.css`), which is the entrance these charts
 * have always had. Leaving both on would play them at once.
 */
export const chartMotion = motion({
  initial: false,
  transition: FOCUS_SPRING,
});

/**
 * The install chart's renderer: the same motion plus the library's own entrance
 * — bars and line grow from the y baseline, staggered, settling ~720ms in.
 *
 * `"always"` rather than `true` to take a branch out of play: the gate is
 * `motion.initial && (!adoptedRoot || motion.initial === "always")`, and
 * `adoptedRoot` is the library's read of server-rendered markup. `true` was
 * measured to animate fine here; `"always"` survives that changing, and this
 * entrance is decorative enough that its loss would be silent.
 *
 * Only works because the install dialog's entrance carries no scale (see
 * `skill-record.tsx`). Through a transform the first real measurement is a
 * `resized` render, which the renderer commits instantly (`resize: false`),
 * cancelling the entrance.
 */
export const chartMotionEntrance = motion({
  initial: "always",
  transition: FOCUS_SPRING,
});

/**
 * True on a touch-primary device.
 *
 * Starts false so the server and first client render agree, then settles after
 * mount — a touch device animates at most its first interaction, which cannot
 * happen before mount anyway.
 */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return coarse;
}

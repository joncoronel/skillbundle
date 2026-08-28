"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `active`, but held true for at least `ms` once it has gone true at all.
 *
 * For a transient state that is worth seeing when it happens: the compare
 * chart's loading placeholder, which leaves through a conceal and a reveal and
 * so needs to have been on screen for the exit to mean anything. Measured
 * there, the data can land about one frame after the chart mounts, and without
 * a hold the chart conceals something nobody saw.
 *
 * Deliberately NOT a spinner floor. The difference is what the flag drives: a
 * spinner exists only to say "wait", so delaying data to keep one up is pure
 * cost. Holding a state that has its own choreography is what stops that
 * choreography being nonsense. Reach for it only where something animates OUT.
 *
 * Costs nothing when `active` is false from the first render — the common case
 * of a warm cache never enters the hold.
 *
 * Timing is not a motion preference, so this does not consult
 * `prefers-reduced-motion`: seeing the state is useful whether or not it is
 * animated, and it is the exit's DURATION that should collapse. Callers gate
 * that separately.
 */
export function useHeldFlag(active: boolean, ms: number) {
  const [held, setHeld] = useState(active);
  const since = useRef(0);

  // The rising edge is adjusted during render, not in an effect: an effect
  // would commit a frame where `active` is true and this still reads false,
  // which is the flash the hold exists to remove.
  if (active && !held) setHeld(true);

  useEffect(() => {
    if (active) since.current = performance.now();
  }, [active]);

  // Only the falling edge waits, and only for whatever is left of `ms`.
  useEffect(() => {
    if (active || !held) return;
    const remaining = Math.max(0, ms - (performance.now() - since.current));
    const timer = setTimeout(() => setHeld(false), remaining);
    return () => clearTimeout(timer);
  }, [active, held, ms]);

  return held;
}

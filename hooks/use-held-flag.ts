"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `active`, but held true for at least `ms` once it has gone true at all.
 *
 * For a transient state that has to be seen to make sense: the compare chart's
 * placeholder leaves through a conceal and a reveal, and the data can land one
 * frame after mount, so without a hold the chart conceals something nobody saw.
 *
 * Deliberately NOT a spinner floor. A spinner exists only to say "wait", so
 * delaying data to keep one up is pure cost; holding a state that has its own
 * choreography is what stops that choreography being nonsense. Reach for this
 * only where something animates OUT.
 *
 * Costs nothing when `active` is false from the first render.
 *
 * Does not consult `prefers-reduced-motion`: seeing the state is useful either
 * way, and it is the exit's DURATION that should collapse. Callers gate that.
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

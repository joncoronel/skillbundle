"use client";

import { useEffect, useState } from "react";

/**
 * Distance from the top of the viewport at which a section counts as entered.
 *
 * The floating header pill ends at 72px; the rest is margin so nothing flips
 * the instant a heading grazes the pill's lower edge. Exported because the
 * skill page's rail and its record card BOTH answer questions about where the
 * reader is, and they have to answer them at the same line — otherwise the card
 * changes state at a different scroll position than the one where the rail
 * lights up "Documentation", and the sidebar looks like two independent widgets
 * reacting to different things.
 */
export const SECTION_OFFSET = 96;

/**
 * Has the reader scrolled into the section with this id?
 *
 * Scroll position rather than IntersectionObserver, for the same reason the
 * rail's scroll spy uses it: an observer answers "is this element visible",
 * which a 20,000px section never fully is. `top <= offset` answers the question
 * actually being asked — is this section's start above the fold line — and it
 * is a single rect read inside a rAF the scroll handler schedules.
 *
 * Returns false while `enabled` is false, which is how the caller keeps a
 * scroll-driven state from firing on layouts where the affected element is not
 * sticky and has no business changing.
 */
export function useEnteredSection(id: string, enabled = true) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let frame = 0;

    const measure = () => {
      frame = 0;
      const el = document.getElementById(id);
      setEntered(el ? el.getBoundingClientRect().top <= SECTION_OFFSET : false);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [id, enabled]);

  // Gated on the way OUT rather than reset when `enabled` goes false. Writing
  // state to clear it would be a setState in an effect body — a cascading
  // render, and one the lint rule correctly refuses — where the answer is
  // simply that a disabled hook has nothing to report.
  return enabled && entered;
}

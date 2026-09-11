"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Infinite-scroll sentinel, shared by every paginated list (home catalog,
 * search results). Attach the returned ref to an invisible
 * marker element after the rows; when it comes within `rootMargin` of the
 * viewport and more pages exist, the next page is fetched.
 *
 * The margin is two viewports below, not a fixed pixel count, and it was
 * measured. A 30-row page is ~1340px on desktop (1.5 viewports) and a fetch
 * takes 300–430ms. At the old `400px`, a brisk scroll covered the margin plus
 * the footer before the page landed, so the user hit the end of the document
 * on every page. Two viewports keeps roughly a page buffered ahead.
 * Percentages resolve against the viewport, so phones get a proportionally
 * shorter lead instead of a desktop-sized one.
 *
 * That lead only applies once the user has scrolled the page. The home page's
 * sentinel starts ~1.9 viewports down, inside the lead, so an armed-on-mount
 * observer fetched page 2 on every visit, including every visitor who never
 * scrolls: a Convex read per page view to replace a server-cached first page
 * that was already enough. Before the first scroll the margin is zero, which
 * still covers a first page that ends on screen (a tall monitor): the list
 * would otherwise stall there with no scroll to arm it. The first scroll
 * rebuilds the observer with the full margin, and since the sentinel is
 * already inside it, page 2 is requested on that scroll with the whole lead
 * still ahead. `scrollY > 0` rather than any scroll event, so the router's
 * scroll-to-top on a client navigation into the page doesn't count.
 *
 * The observer is deliberately rebuilt when the flags change (they're effect
 * deps, not ref-reads): a freshly-created IntersectionObserver fires its
 * callback for already-intersecting targets, so the rebuild after a page
 * lands is what keeps loading going when the sentinel is STILL in view (a
 * mount-once observer gets no new intersection event there and stalls until
 * the user scrolls). Two rebuilds per page is the cost of not stalling.
 */
export function useInfiniteScrollSentinel({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (scrolled) return;
    function onScroll() {
      if (window.scrollY > 0) setScrolled(true);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrolled]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: scrolled ? "0px 0px 200% 0px" : "0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, scrolled]);

  return sentinelRef;
}

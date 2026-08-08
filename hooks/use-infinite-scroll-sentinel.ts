"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Infinite-scroll sentinel, shared by every paginated list (home catalog,
 * search results). Attach the returned ref to an invisible
 * marker element after the rows; when it comes within `rootMargin` of the
 * viewport and more pages exist, the next page is fetched.
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

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return sentinelRef;
}

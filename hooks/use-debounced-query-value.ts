"use client";

import { useEffect, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-params";

/**
 * The one debounce + cache-bypass state machine behind every search input
 * (home catalog, /explore, the compare/bundle pickers). Returns the
 * "effective" query the caller should actually fetch with:
 *
 * - **Debounce:** the returned value trails the raw input by
 *   SEARCH_DEBOUNCE_MS so mid-word keystrokes don't fire fetches.
 * - **Synchronous cache bypass:** if the trimmed input's results are already
 *   cached (per `getCacheKey`), the debounce is skipped and the trimmed input
 *   is returned immediately — retyping a recent query swaps results instantly,
 *   with no pending dim and no spinner.
 * - **Render-time reset on clear:** clearing the input resets the debounced
 *   value in the same render, so a fast retype never sees the previous query
 *   leak through.
 *
 * Callers derive their loading UI from `raw.trim() !== effective` plus their
 * own query state — never from timers (see the derived-loading-state rule).
 */
export function useDebouncedQueryValue(
  rawQuery: string,
  /** Build the React Query key under which `trimmed`'s results would live. */
  getCacheKey: (trimmed: string) => QueryKey,
): string {
  const trimmed = rawQuery.trim();

  const [debounced, setDebounced] = useState(trimmed);
  if (!trimmed && debounced) setDebounced("");
  useEffect(() => {
    if (!trimmed) return;
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const queryClient = useQueryClient();
  const isCached =
    trimmed !== debounced &&
    trimmed.length > 0 &&
    queryClient.getQueryData(getCacheKey(trimmed)) !== undefined;

  return trimmed ? (isCached ? trimmed : debounced) : "";
}

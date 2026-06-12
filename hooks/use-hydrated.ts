"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * False during SSR and the hydration render, true after (and immediately on
 * post-hydration mounts). Gate client-only state (localStorage, etc.) on this
 * so the hydration render matches the server HTML — rendering such state
 * during hydration causes a mismatch whenever the value loaded before React
 * hydrated the subtree.
 */
export function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

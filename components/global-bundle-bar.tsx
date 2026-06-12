"use client";

import { usePathname } from "next/navigation";
import { BundleBar } from "@/components/bundle-bar";

// Routes that surface the bundle selection bar. Allow-list, not a hide-list:
// the org routes (`/:org`, `/:org/:repo`) match any short path, so exclusion
// logic is error-prone (see the same note in proxy.ts).
const BUNDLE_BAR_ROUTES = new Set(["/", "/compare"]);

/**
 * Mounts the bundle bar from the (main) layout so the same instance persists
 * across navigations between bundle surfaces — the expanded tray and other
 * local state survive e.g. home → compare instead of remounting per page.
 * Navigating to a route outside the list unmounts it (state resets), which
 * matches the old per-page behavior.
 */
export function GlobalBundleBar() {
  const pathname = usePathname();
  if (!BUNDLE_BAR_ROUTES.has(pathname)) return null;
  return <BundleBar />;
}
